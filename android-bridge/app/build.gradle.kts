plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.smsweb.gateway"
    compileSdk = 35

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.smsweb.gateway"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(rootProject.file("../web"))
        }
    }
}

kotlin {
    jvmToolchain(17)
}
