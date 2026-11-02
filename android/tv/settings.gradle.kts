// The one project: the app. Versions are AGP 8.13 / Gradle 8.14, the pair
// this machine already builds Kumiko's Capacitor app with (doc/TV-APP.md).
pluginManagement {
	repositories {
		google()
		mavenCentral()
		gradlePluginPortal()
	}
}

dependencyResolutionManagement {
	repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
	repositories {
		google()
		mavenCentral()
	}
}

rootProject.name = "tsundoku-tv"
include(":app")
