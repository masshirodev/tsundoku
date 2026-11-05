plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.android")
}

/**
 * Release signing is a keystore that outlives this machine, so it is never in
 * the repository: the four names below are the contract, and doc/TV-APP.md has
 * the steps to make one. Without them there is no release signing, and
 * ops/release/tv-apk.sh builds a debug-signed APK called `-debug` instead.
 */
fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

val keystore = env("TSUNDOKU_TV_KEYSTORE")?.let(::file)
val keystorePassword = env("TSUNDOKU_TV_KEYSTORE_PASSWORD")
// Not named keyAlias / keyPassword: inside create("release") {} those names
// are the SigningConfig's own (empty) properties, and would shadow these.
val tvKeyAlias = env("TSUNDOKU_TV_KEY_ALIAS")
val tvKeyPassword = env("TSUNDOKU_TV_KEY_PASSWORD")
val canSign =
	keystore != null && keystore.isFile && keystorePassword != null && tvKeyAlias != null && tvKeyPassword != null

/** The release's date version, when the release script passes one. */
val tvVersion: String =
	(project.findProperty("versionName") as String?) ?: env("TSUNDOKU_TV_VERSION") ?: "1.0.0"

android {
	namespace = "dev.masshiro.tsundoku.tv"
	compileSdk = 36

	defaultConfig {
		// Old TV boxes: nothing here needs more (OnBackPressedDispatcher is in
		// androidx.activity and works down to 21). See doc/TV-APP.md.
		minSdk = 23
		targetSdk = 36
		versionCode = 1
		versionName = tvVersion
	}

	/*
	 * Two apps from one project (c521; doc/PHONE-APP.md): the TV's, and the
	 * phone and tablet one. Every line of pairing is shared (src/main); what
	 * differs is decided by Form.kt from FORM, and the little that is
	 * manifest or theme lives in src/tv and src/mobile. The Kotlin package
	 * and the namespace stay dev.masshiro.tsundoku.tv for both: renaming them
	 * would move every file for no behaviour, and the application id is what
	 * Android installs by.
	 */
	flavorDimensions += "form"
	productFlavors {
		create("tv") {
			dimension = "form"
			applicationId = "dev.masshiro.tsundoku.tv"
			buildConfigField("String", "FORM", "\"tv\"")
		}
		create("mobile") {
			dimension = "form"
			applicationId = "dev.masshiro.tsundoku.app"
			buildConfigField("String", "FORM", "\"mobile\"")
		}
	}

	signingConfigs {
		if (canSign) {
			create("release") {
				storeFile = keystore
				storePassword = keystorePassword
				keyAlias = tvKeyAlias
				keyPassword = tvKeyPassword
			}
		}
	}

	buildTypes {
		release {
			isMinifyEnabled = false
			proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
			signingConfig = if (canSign) signingConfigs.getByName("release") else null
		}
	}

	buildFeatures {
		buildConfig = true
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}

	testOptions {
		unitTests.isReturnDefaultValues = true
	}
}

kotlin {
	compilerOptions {
		jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
	}
}

dependencies {
	// ComponentActivity, and the OnBackPressedDispatcher BACK goes through
	// (the deprecated onBackPressed override is not an option at targetSdk 36).
	implementation("androidx.activity:activity:1.11.0")
	// WindowInsetsControllerCompat, for hiding the system UI around the page.
	implementation("androidx.core:core-ktx:1.17.0")
	testImplementation("junit:junit:4.13.2")
}
