package ru.spacemap.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

class ReleaseTest {

    private val source = URI("https://stand.example/downloads/space-map.json")
    private val sha = "a".repeat(64)

    private fun json(apk: String = "space-map-6.apk", sha256: String = sha, size: Long = 44_000_000, extra: String = "") =
        JSONObject("""{"versionCode":6,"versionName":"0.2.1","apk":"$apk","size":$size,"sha256":"$sha256"$extra}""")

    @Test
    fun `адрес APK считается от адреса описания`() {
        val release = Release.parse(json(extra = ""","notes":["Тихая съёмка","Превью"],"minVersionCode":3"""), source)
        assertEquals(URI("https://stand.example/downloads/space-map-6.apk"), release.apk)
        assertEquals(listOf("Тихая съёмка", "Превью"), release.notes)
        assertEquals(3, release.minVersionCode)
    }

    @Test
    fun `без заметок и обязательной версии — пустые значения`() {
        val release = Release.parse(json(), source)
        assertEquals(emptyList<String>(), release.notes)
        assertEquals(0, release.minVersionCode)
    }

    @Test
    fun `APK с другого сервера не принимаем`() {
        for (apk in listOf("https://evil.example/x.apk", "//evil.example/x.apk", "http://stand.example/downloads/x.apk", "https://stand.example:8443/x.apk")) {
            assertThrows(apk, IllegalArgumentException::class.java) { Release.parse(json(apk = apk), source) }
        }
    }

    @Test
    fun `кривые sha256 и размер не принимаем`() {
        assertThrows(IllegalArgumentException::class.java) { Release.parse(json(sha256 = "abc"), source) }
        assertThrows(IllegalArgumentException::class.java) { Release.parse(json(size = 0), source) }
        assertThrows(IllegalArgumentException::class.java) { Release.parse(json(size = 500L * 1024 * 1024), source) }
        assertEquals(sha, Release.parse(json(sha256 = sha.uppercase()), source).sha256)
    }

    @Test
    fun `не предлагаем ту же или старую сборку`() {
        val release = Release.parse(json(), source)
        assertFalse(shouldOffer(release, installed = 6, postponed = null, now = 0))
        assertFalse(shouldOffer(release, installed = 7, postponed = null, now = 0))
        assertTrue(shouldOffer(release, installed = 5, postponed = null, now = 0))
    }

    @Test
    fun `обязательное обновление предлагаем даже после «Позже»`() {
        val release = Release.parse(json(extra = ""","minVersionCode":6"""), source)
        assertTrue(shouldOffer(release, installed = 5, postponed = Postponed(6, at = 1_000), now = 1_001))
    }
}
