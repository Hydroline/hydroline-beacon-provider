import net.fabricmc.loom.api.LoomGradleExtensionAPI
import org.gradle.api.Project
import org.gradle.api.tasks.SourceSetContainer
import org.gradle.api.tasks.bundling.Jar
import org.gradle.api.tasks.compile.JavaCompile
import org.gradle.jvm.toolchain.JavaLanguageVersion
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.getByType
import org.gradle.kotlin.dsl.named
import org.gradle.language.jvm.tasks.ProcessResources
import kotlin.math.max

plugins {
    id("dev.architectury.loom") version "1.6.422" apply false
    id("base")
}

data class McTarget(
    val minecraftVersion: String,
    val forgeVersion: String,
    val fabricLoaderVersion: String,
    val fabricApiVersion: String,
    val javaVersion: Int,
    val packFormat: Int
)

enum class LoaderType {
    FABRIC,
    FORGE
}

data class LoaderProject(
    val name: String,
    val loader: LoaderType,
    val target: McTarget
)

val supportedTargets = mapOf(
    "1.16.5" to McTarget(
        minecraftVersion = "1.16.5",
        forgeVersion = "1.16.5-36.2.39",
        fabricLoaderVersion = "0.14.23",
        fabricApiVersion = "0.42.0+1.16",
        javaVersion = 8,
        packFormat = 6
    ),
    "1.18.2" to McTarget(
        minecraftVersion = "1.18.2",
        forgeVersion = "1.18.2-40.2.21",
        fabricLoaderVersion = "0.14.23",
        fabricApiVersion = "0.76.0+1.18.2",
        javaVersion = 17,
        packFormat = 8
    ),
    "1.20.1" to McTarget(
        minecraftVersion = "1.20.1",
        forgeVersion = "1.20.1-47.1.3",
        fabricLoaderVersion = "0.15.10",
        fabricApiVersion = "0.92.1+1.20.1",
        javaVersion = 17,
        packFormat = 15
    )
)

val loaderProjects = listOf(
    LoaderProject("fabric-1.16.5", LoaderType.FABRIC, supportedTargets.getValue("1.16.5")),
    LoaderProject("fabric-1.18.2", LoaderType.FABRIC, supportedTargets.getValue("1.18.2")),
    LoaderProject("fabric-1.20.1", LoaderType.FABRIC, supportedTargets.getValue("1.20.1")),
    LoaderProject("forge-1.16.5", LoaderType.FORGE, supportedTargets.getValue("1.16.5")),
    LoaderProject("forge-1.18.2", LoaderType.FORGE, supportedTargets.getValue("1.18.2")),
    LoaderProject("forge-1.20.1", LoaderType.FORGE, supportedTargets.getValue("1.20.1"))
)

subprojects {
    group = property("mavenGroup") as String
    version = property("modVersion") as String

    repositories {
        mavenLocal()
        maven("https://maven.fabricmc.net/")
        maven("https://maven.minecraftforge.net/")
        mavenCentral()
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
    }
}

loaderProjects.forEach { loaderProject ->
    project(":${loaderProject.name}") {
        configureLoaderProject(loaderProject)
    }
}

val targetBuildTasks = supportedTargets.mapValues { (version, _) ->
    val taskName = "buildTarget_${version.replace('.', '_')}"
    tasks.register(taskName) {
        group = "build"
        description = "Build Forge and Fabric variants for Minecraft $version"
        val targets = loaderProjects
            .filter { it.target.minecraftVersion == version }
            .map { ":${it.name}:build" }
        dependsOn(targets)
    }
}

val buildAllTargets = tasks.register("buildAllTargets") {
    group = "build"
    description = "Build every supported Minecraft/loader combination"
    dependsOn(targetBuildTasks.values)
}

tasks.named("build") {
    dependsOn(buildAllTargets)
}

fun Project.configureLoaderProject(config: LoaderProject) {
    evaluationDependsOn(":common")
    apply(plugin = "dev.architectury.loom")

    val archivesBaseName = rootProject.property("archivesBaseName") as String
    base.archivesName.set("$archivesBaseName-${config.loader.name.lowercase()}-${config.target.minecraftVersion}")

    val compileLanguageVersion = max(config.target.javaVersion, 17)
    extensions.configure<org.gradle.api.plugins.JavaPluginExtension>("java") {
        toolchain.languageVersion.set(JavaLanguageVersion.of(compileLanguageVersion))
        withSourcesJar()
    }

    tasks.withType<JavaCompile>().configureEach {
        options.release.set(config.target.javaVersion)
    }

    val loomExtension = extensions.getByType<LoomGradleExtensionAPI>()
    loomExtension.silentMojangMappingsLicense()
    if (config.loader == LoaderType.FORGE) {
        loomExtension.forge {
            convertAccessWideners.set(false)
        }
    }

    val commonProject = project(":common")
    val commonSources = commonProject.extensions.getByType(SourceSetContainer::class.java)
        .getByName("main").output

    dependencies {
        add("minecraft", "com.mojang:minecraft:${config.target.minecraftVersion}")
        add("mappings", loomExtension.officialMojangMappings())
        add("implementation", commonProject)
    }

    tasks.withType<Jar>().configureEach {
        dependsOn(commonProject.tasks.named("classes"))
        from(commonSources)
    }

    when (config.loader) {
        LoaderType.FABRIC -> configureFabricProject(config)
        LoaderType.FORGE -> configureForgeProject(config)
    }
}

fun Project.configureFabricProject(config: LoaderProject) {
    dependencies {
        add("modImplementation", "net.fabricmc:fabric-loader:${config.target.fabricLoaderVersion}")
        add("modImplementation", "net.fabricmc.fabric-api:fabric-api:${config.target.fabricApiVersion}")
    }

    configurations.maybeCreate("developmentFabric").extendsFrom(configurations.getByName("runtimeClasspath"))

    tasks.named<ProcessResources>("processResources") {
        inputs.property("version", version)
        filesMatching("fabric.mod.json") {
            expand(mapOf("version" to version))
        }
    }
}

fun Project.configureForgeProject(config: LoaderProject) {
    dependencies {
        add("forge", "net.minecraftforge:forge:${config.target.forgeVersion}")
    }

    configurations.maybeCreate("developmentForge").extendsFrom(configurations.getByName("runtimeClasspath"))

    tasks.named<ProcessResources>("processResources") {
        inputs.property("version", version)
        filesMatching("META-INF/mods.toml") {
            expand(mapOf("version" to version))
        }
    }
}
