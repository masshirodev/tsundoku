plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.android")
}

/**
 * Release signing is a keystore that outlives this machine, so it is never in
 * the repository: the four names below are the contract, and doc/ANDROID.md has
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

/**
 * Android's versionCode from the date version, YYYYMMDDNN, so every release is
 * newer to the installer than the one before and an update installs over it
 * (c614). `Versions.code` in the app is the same rule; VersionsTest pins the
 * two together. A name that is no date version is 1, as every build was.
 */
fun versionCodeOf(name: String): Int {
	val m = Regex("^(\\d{4})\\.(\\d{2})\\.(\\d{2})(?:\\.(\\d+))?").find(name) ?: return 1
	val (y, mo, d, n) = m.destructured
	return y.toInt() * 1_000_000 + mo.toInt() * 10_000 + d.toInt() * 100 + n.ifEmpty { "0" }.toInt().coerceAtMost(99)
}

android {
	namespace = "dev.masshiro.tsundoku.tv"
	compileSdk = 36

	defaultConfig {
		// Old TV boxes: nothing here needs more (OnBackPressedDispatcher is in
		// androidx.activity and works down to 21). See doc/ANDROID.md.
		minSdk = 23
		targetSdk = 36
		versionCode = versionCodeOf(tvVersion)
		versionName = tvVersion
		// Where releases are published (doc/UPDATES.md): the same host every
		// installed computer checks. An environment value is for a test host.
		buildConfigField(
			"String",
			"UPDATES_URL",
			"\"" + (env("TSUNDOKU_UPDATES_URL") ?: "https://dl.tsundoku.masshiro.pro") + "\""
		)
	}

	/*
	 * Two apps from one project (c521; doc/ANDROID.md): the TV's, and the
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
	// ed25519 for latest.json's signature (c614): Android 6 has none of its own.
	implementation("net.i2p.crypto:eddsa:0.3.0")
	// WebViewAssetLoader (c549): the app's own page is served at an https
	// origin a message listener's origin rule can name, not from file://.
	// 1.14.0 is what this machine's Gradle cache holds (doc/ANDROID.md).
	implementation("androidx.webkit:webkit:1.14.0")
	testImplementation("junit:junit:4.13.2")
	// org.json for real in the JVM tests: android.jar's stubs return nothing.
	testImplementation("org.json:json:20240303")
}
