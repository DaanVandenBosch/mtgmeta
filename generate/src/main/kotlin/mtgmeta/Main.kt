@file:OptIn(ExperimentalSerializationApi::class)

package mtgmeta

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers
import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.createDirectory
import kotlin.io.path.deleteExisting
import kotlin.io.path.div
import kotlin.io.path.exists
import kotlin.io.path.inputStream
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.notExists
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.decodeFromStream

private val httpClient: HttpClient = HttpClient.newHttpClient()

private val json = Json {
    namingStrategy = JsonNamingStrategy.SnakeCase
    explicitNulls = false
    ignoreUnknownKeys = true
}

fun main() {
    Preprocessor().preprocess()
}

@Serializable
class SfBulkResponse(
    val data: List<SfBulkData>,
)

@Serializable
class SfBulkData(
    val id: String,
    val uri: String,
    val type: String,
    val name: String,
    val description: String,
    /** URI of the bulk JSON file. */
    val downloadUri: String,
    /** In ISO 8601 format. */
    val updatedAt: String,
    val contentType: String,
    val contentEncoding: String,
    val size: Long,
)

@Serializable
class SfCard(
    val id: String,
    val oracleId: String?,
    val name: String,
    val releasedAt: String,
    val scryfallUri: String,
    val layout: String,
    val imageStatus: SfImageStatus,
    val imageUris: SfCardImageUris?,
    val manaCost: String?,
    /** Reversible cards have their CMC on the faces. */
    val cmc: Double?,
    /** Reversible cards have their type line on the faces. */
    val typeLine: String?,
    val oracleText: String?,
    val colors: List<String>?,
    val colorIdentity: List<String>,
    val cardFaces: List<SfCardFace>?,
    val legalities: Map<String, SfLegality>,
    val set: String,
    val setType: String,
    val collectorNumber: String,
    val digital: Boolean,
    val rarity: SfRarity,
    val promoTypes: List<String>?,
)

enum class SfImageStatus {
    missing,
    placeholder,
    lowres,
    highres_scan
}

@Serializable
class SfCardImageUris(
    val png: String?,
    val large: String?,
    val normal: String?,
    val small: String?,
)

@Serializable
class SfCardFace(
    val name: String,
    val manaCost: String,
    val cmc: Double?,
    val typeLine: String?,
    val oracleText: String,
    val colors: List<String>?,
    val imageUris: Map<String, String>?,
)

enum class SfLegality {
    legal,
    not_legal,
    restricted,
    banned,
}

enum class SfRarity {
    common,
    uncommon,
    rare,
    special,
    mythic,
    bonus,
}

private class Preprocessor {
    fun preprocess() {
        log("Getting Scryfall bulk data information.")
        val bulkResponse: SfBulkResponse =
            httpGetJson("https://api.scryfall.com/bulk-data")

        log("Processing Scryfall \"Oracle\" cards.");
        // We do an initial pass over the oracle cards to get the most legible version of each card.

        val oracleCards = getCardData(bulkResponse, "oracle_cards")

        log("Processing Scryfall \"Default\" cards.")
        // Do a pass over the default cards, to get the information of all card versions.

        val defaultCards = getCardData(bulkResponse, "default_cards")

        log("Sorting.")
    }
}

private inline fun <reified T> httpGetJson(url: String): T {
    val response = httpClient.send(
        HttpRequest.newBuilder().GET().uri(URI(url)).build(),
        BodyHandlers.ofInputStream(),
    )

    if (response.statusCode() !in 200..299) {
        throw Exception("Got ${response.statusCode()}.")
    }

    return response.body().use(json::decodeFromStream)
}

private fun httpGetToFile(url: String, file: Path) {
    val response = httpClient.send(
        HttpRequest.newBuilder().GET().uri(URI(url)).build(),
        BodyHandlers.ofFile(file),
    )

    if (response.statusCode() !in 200..299) {
        throw Exception("Got ${response.statusCode()}.")
    }
}

private fun getCardData(bulkResponse: SfBulkResponse, type: String): List<SfCard> {
    for (data in (bulkResponse.data)) {
        if (data.type != type) {
            continue
        }

        if (!data.downloadUri.endsWith(".json")) {
            throw Exception("Bulk data URI didn't end with .json: ${data.downloadUri}")
        }

        val lastSlash = data.downloadUri.lastIndexOf('/')

        if (lastSlash == -1) {
            throw Exception("Bulk data URI doesn't have any slashes: ${data.downloadUri}")
        }

        val filename: String = data.downloadUri.substring(lastSlash + 1)
        val filenameParts =
            Regex("""^([a-z]+[a-z0-9-]+-)\d+\.json$""").matchEntire(filename)
                ?: throw Exception("Computed filename looks wrong: $filename")

        val dir = Path("../preprocessing")
        val file = dir / filename

        if (file.exists()) {
            log("Found a file named ${filename}, loading it.")
        } else {
            log("No file named ${filename}, downloading bulk data.")

            if (dir.notExists()) {
                dir.createDirectory()
            }

            try {
                httpGetToFile(data.downloadUri, file)
            } catch (e: Exception) {
                file.deleteExisting()
            }
        }

        val cards: List<SfCard> = file.inputStream().use(json::decodeFromStream)

        // Delete old files of the same type.
        for (f in dir.listDirectoryEntries()) {
            if (f.name.startsWith(filenameParts.groupValues[1])
                && f.name.endsWith(".json")
                && f.name != filename
            ) {
                f.deleteExisting()
            }
        }

        return cards
    }

    throw Exception("Couldn't find bulk data URI for type ${type}.")
}

@OptIn(ExperimentalTime::class)
private fun log(text: String) {
    println("${Clock.System.now()} $text")
}
