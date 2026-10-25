import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.relay"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.relay.mesh"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-unverified-demo"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signing is supplied from ~/.gradle/gradle.properties or env, never from the repo (see docs/android/BUILD.md).
            val ks = System.getenv("RELAY_KEYSTORE")
            if (ks != null) {
                signingConfigs.create("relayRelease") {
                    storeFile = file(ks)
                    storePassword = System.getenv("RELAY_KEYSTORE_PASSWORD")
                    keyAlias = System.getenv("RELAY_KEY_ALIAS")
                    keyPassword = System.getenv("RELAY_KEY_PASSWORD")
                }
                signingConfig = signingConfigs.getByName("relayRelease")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets { getByName("test").kotlin.srcDir("src/sharedTest/kotlin"); getByName("androidTest").kotlin.srcDir("src/sharedTest/kotlin") }
    packaging { resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*") }
}

// The UI is NOT forked: the approved mobile design is copied from ../../prototype at build time.
// index.html -> web/app.html with two extra script tags (native flag + bridge). The browser prototype is untouched.
val syncRelayAssets by tasks.registering(Copy::class) {
    into(layout.buildDirectory.dir("generated/relayAssets"))
    into("web") {
        from("../../prototype") { include("style.css", "app.js", "mesh.js") }
        from("../../prototype") {
            include("index.html")
            rename("index.html", "app.html")
            filter { line ->
                line.replace(
                    "<script src=\"mesh.js\"></script>",
                    "<script>window.RELAY_NATIVE=true;</script><script src=\"mesh.js\"></script><script src=\"native_bridge.js\"></script>"
                )
            }
        }
        from("src/native-web")
    }
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/relayAssets"))
// Every task that reads the generated assets must run after the copy (asset merge, lint, packaging). tests/verify_apk.sh double-checks the result.
tasks.configureEach {
    val n = name
    if ((n.startsWith("merge") && n.endsWith("Assets")) || n.contains("lint", ignoreCase = true) || n.startsWith("package")) dependsOn(syncRelayAssets)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.crypto.tink:tink-android:1.13.0")

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
}
