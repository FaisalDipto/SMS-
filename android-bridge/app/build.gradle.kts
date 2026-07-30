plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun buildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val userServiceNumber = providers.gradleProperty("SMSWEB_USER_SERVICE_NUMBER")
    .orElse("+8801701485658")
    .get()
val userDemoAuthenticationKey = providers.gradleProperty("SMSWEB_USER_DEMO_AUTH_KEY")
    .orElse("smsweb-local-judge-demo-key")
    .get()

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
        versionCode = 6
        versionName = "0.3.3"
    }

    flavorDimensions += "edition"
    productFlavors {
        create("gateway") {
            dimension = "edition"
            buildConfigField("String", "APP_ROLE", buildConfigString("GATEWAY"))
            buildConfigField("boolean", "ROLE_LOCKED", "true")
            buildConfigField("String", "DEFAULT_SERVICE_NUMBER", buildConfigString(""))
            buildConfigField("String", "DEFAULT_AUTHENTICATION_KEY", buildConfigString(""))
            resValue("string", "app_name", "SMSWeb Gateway")
        }
        create("user") {
            dimension = "edition"
            applicationIdSuffix = ".user"
            versionNameSuffix = "-user"
            buildConfigField("String", "APP_ROLE", buildConfigString("USER"))
            buildConfigField("boolean", "ROLE_LOCKED", "true")
            buildConfigField(
                "String",
                "DEFAULT_SERVICE_NUMBER",
                buildConfigString(userServiceNumber)
            )
            buildConfigField(
                "String",
                "DEFAULT_AUTHENTICATION_KEY",
                buildConfigString(userDemoAuthenticationKey)
            )
            resValue("string", "app_name", "SMSWeb")
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(rootProject.file("../web"))
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    jvmToolchain(17)
}
