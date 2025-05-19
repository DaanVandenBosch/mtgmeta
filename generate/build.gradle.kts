plugins {
    kotlin("jvm")
    kotlin("plugin.serialization") version "2.1.20"
    application
}

group = "com.daanvandenbosch"
version = "1.0-SNAPSHOT"

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("mtgmeta.MainKt")
    applicationDefaultJvmArgs = listOf("-Xmx4g")
}

repositories {
    mavenCentral()
}

val jacksonVersion = "2.18.3"

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
}
