import org.jetbrains.kotlin.gradle.tasks.KotlinTest

plugins {
    kotlin("multiplatform") version "2.1.20"
}

group = "com.daanvandenbosch"
version = "1.0-SNAPSHOT"

kotlin {
    js {
        browser {
            runTask {
                devServerProperty.set(
                    devServerProperty.get().copy(
                        open = false,
                        port = 2040,
                    )
                )
            }
        }
        binaries.executable()
    }

    sourceSets {
        jsMain.dependencies {
            implementation("biota:gui-dom:1.0-SNAPSHOT")
        }

        jsTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

// Always run all tests.
tasks.withType<KotlinTest>().configureEach {
    outputs.upToDateWhen { false }
}

repositories {
    mavenCentral()
    mavenLocal()
}
