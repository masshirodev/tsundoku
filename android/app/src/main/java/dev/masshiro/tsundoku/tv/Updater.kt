package dev.masshiro.tsundoku.tv

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ExecutorService

/**
 * The app updating itself (c614; doc/UPDATES.md, "The Android apps"): it
 * looks at the release host's `latest.json`, at most once a day and when
 * asked; offers a newer release's APK for its own form; downloads it into
 * its cache, checked against the signed size and SHA-256; and hands it to
 * Android's PackageInstaller. Android shows its own "Update this app?" the
 * first time; on Android 12 and later, once the app installed itself, it may
 * update without asking again (`USER_ACTION_NOT_REQUIRED`).
 *
 * The web app draws all of it (SETTINGS' UPDATES line, the library's modal),
 * through the bridge's `appUpdate`, `appCheck`, `appDownload` and
 * `appInstall`; every change of state is posted to the page as
 * `window.tsundokuAppUpdate(state)`. The decisions are [Plan]'s, pure and
 * tested; this class is the I/O.
 */
class Updater(
	private val context: Context,
	private val form: Form,
	private val running: String,
	private val base: String,
	private val io: ExecutorService,
	private val post: (State) -> Unit
) {
	/** What the page is told: one object, the whole state. */
	data class State(
		val running: String,
		val phase: Phase = Phase.IDLE,
		val release: ReleaseCheck.Release? = null,
		/** Bytes downloaded so far, while DOWNLOADING. */
		val got: Long = 0,
		/** When it last looked, in ms; 0 for never. */
		val checkedAt: Long = 0,
		/** What went wrong, in the page's words, while ERROR. */
		val error: String = ""
	) {
		fun toJson(): String {
			val o = JSONObject().put("running", running).put("phase", phase.id).put("checkedAt", checkedAt)
			release?.let { r ->
				o.put("version", r.version).put("date", r.date).put("notes", r.notes)
				r.apk?.let { o.put("size", it.size) }
			}
			if (phase == Phase.DOWNLOADING) o.put("got", got)
			if (error.isNotEmpty()) o.put("error", error)
			return o.toString()
		}
	}

	enum class Phase(val id: String) {
		IDLE("idle"),
		CHECKING("checking"),
		CURRENT("current"),
		AVAILABLE("available"),
		DOWNLOADING("downloading"),
		READY("ready"),
		PERMISSION("permission"),
		INSTALLING("installing"),
		ERROR("error")
	}

	/** The pure part: what a check's answer means, and when to look. */
	object Plan {
		const val DAY = 24 * 60 * 60 * 1000L

		/** Look on launch only when the last look is a day old or more, or never happened. */
		fun due(checkedAt: Long, now: Long): Boolean = checkedAt <= 0 || now - checkedAt >= DAY || now < checkedAt

		/** A release is on offer when it is newer than this build and has this form's APK. */
		fun offer(release: ReleaseCheck.Release, running: String): Boolean = release.apk != null && Versions.newer(release.version, running)

		/** The file name a downloaded release is kept under in the cache. */
		fun cacheName(release: ReleaseCheck.Release): String = "tsundoku-${release.version}.apk"
	}

	@Volatile
	var state = State(running, checkedAt = prefs().getLong(KEY_CHECKED, 0))
		private set

	private fun prefs() = context.getSharedPreferences("updates", Context.MODE_PRIVATE)

	private fun set(next: State) {
		state = next
		post(next)
	}

	private fun dir() = File(context.cacheDir, "updates").apply { mkdirs() }

	/** On launch: look if a day has passed. Never for a build with no date version, which is not a release. */
	fun launched(now: Long = System.currentTimeMillis()) {
		if (Versions.parts(running) == null) return
		if (Plan.due(state.checkedAt, now)) check()
	}

	/** CHECK, or the daily look. One at a time; a check while downloading is not started. */
	fun check() {
		if (state.phase == Phase.CHECKING || state.phase == Phase.DOWNLOADING || state.phase == Phase.INSTALLING) return
		set(state.copy(phase = Phase.CHECKING, error = ""))
		io.execute {
			val now = System.currentTimeMillis()
			val text =
				try {
					fetchText("${base.trimEnd('/')}/latest.json")
				} catch (e: Exception) {
					set(state.copy(phase = Phase.ERROR, error = "THE RELEASE HOST DIDN'T ANSWER"))
					return@execute
				}
			prefs().edit().putLong(KEY_CHECKED, now).apply()
			when (val opened = ReleaseCheck.open(text, form)) {
				is ReleaseCheck.Opened.Refused ->
					set(state.copy(phase = Phase.ERROR, checkedAt = now, error = "THE RELEASE ISN'T SIGNED BY TSUNDOKU'S KEY"))
				is ReleaseCheck.Opened.Ok -> {
					val r = opened.release
					// What an earlier version left in the cache is never needed again.
					dir().listFiles()?.filter { it.name != Plan.cacheName(r) }?.forEach { it.delete() }
					val ready = File(dir(), Plan.cacheName(r)).let { f -> r.apk != null && f.length() == r.apk.size }
					set(
						state.copy(
							phase =
								when {
									!Plan.offer(r, running) -> Phase.CURRENT
									ready -> Phase.READY
									else -> Phase.AVAILABLE
								},
							release = r,
							checkedAt = now
						)
					)
				}
			}
		}
	}

	/** UPDATE: the APK into the cache, checked, then straight on to the installer. */
	fun download() {
		val r = state.release ?: return
		val apk = r.apk ?: return
		if (state.phase == Phase.READY) {
			install()
			return
		}
		if (state.phase != Phase.AVAILABLE && state.phase != Phase.ERROR) return
		set(state.copy(phase = Phase.DOWNLOADING, got = 0, error = ""))
		io.execute {
			val file = File(dir(), Plan.cacheName(r))
			val part = File(dir(), Plan.cacheName(r) + ".part")
			try {
				val digest = MessageDigest.getInstance("SHA-256")
				var got = 0L
				var told = 0L
				val conn = open(ReleaseCheck.fileUrl(base, r.version, apk))
				conn.inputStream.use { input ->
					part.outputStream().use { out ->
						val buf = ByteArray(64 * 1024)
						while (true) {
							val n = input.read(buf)
							if (n < 0) break
							out.write(buf, 0, n)
							digest.update(buf, 0, n)
							got += n
							// The page's bar moves by whole percents, not every 64 KB.
							if (got - told >= apk.size / 100 || got == apk.size) {
								told = got
								set(state.copy(got = got))
							}
							if (got > apk.size) break
						}
					}
				}
				val sha = digest.digest().joinToString("") { "%02x".format(it) }
				if (!ReleaseCheck.matches(apk, got, sha)) {
					part.delete()
					set(state.copy(phase = Phase.ERROR, error = "THE DOWNLOAD ISN'T THE SIGNED FILE · NOTHING WAS INSTALLED"))
					return@execute
				}
				part.renameTo(file)
				set(state.copy(phase = Phase.READY))
				install()
			} catch (e: Exception) {
				part.delete()
				set(state.copy(phase = Phase.ERROR, error = "THE DOWNLOAD STOPPED · TRY AGAIN"))
			}
		}
	}

	/**
	 * The checked APK to Android's installer. Android 8 and later ask once to
	 * allow installs from tsundoku: until then the page says PERMISSION and the
	 * system's own switch is opened; coming back to the app installs.
	 */
	fun install() {
		val r = state.release ?: return
		val file = File(dir(), Plan.cacheName(r))
		if (!file.isFile) {
			set(state.copy(phase = Phase.AVAILABLE))
			return
		}
		if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
			set(state.copy(phase = Phase.PERMISSION))
			val ask = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
			context.startActivity(ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
			return
		}
		set(state.copy(phase = Phase.INSTALLING))
		io.execute {
			try {
				val installer = context.packageManager.packageInstaller
				val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
				if (Build.VERSION.SDK_INT >= 31) {
					params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
				}
				val id = installer.createSession(params)
				installer.openSession(id).use { session ->
					file.inputStream().use { input ->
						session.openWrite("base.apk", 0, file.length()).use { out ->
							input.copyTo(out)
							session.fsync(out)
						}
					}
					val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
					val done = Intent(context, Answer::class.java).setAction(ACTION)
					session.commit(PendingIntent.getBroadcast(context, id, done, flags).intentSender)
				}
			} catch (e: Exception) {
				set(state.copy(phase = Phase.ERROR, error = "ANDROID REFUSED THE UPDATE · TRY AGAIN"))
			}
		}
	}

	/** Back in the app: the switch that was asked for may be on now. */
	fun resumed() {
		if (state.phase != Phase.PERMISSION) return
		if (Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()) install()
	}

	/** The installer's answer for a session that failed or was cancelled. */
	internal fun answered(status: Int, message: String?) {
		when (status) {
			PackageInstaller.STATUS_SUCCESS -> Unit // The app is replaced; this process ends.
			PackageInstaller.STATUS_FAILURE_ABORTED -> set(state.copy(phase = Phase.READY))
			else -> set(state.copy(phase = Phase.ERROR, error = "ANDROID REFUSED THE UPDATE · ${message.orEmpty().uppercase().take(80)}"))
		}
	}

	private fun open(url: String): HttpURLConnection {
		val conn = URL(url).openConnection() as HttpURLConnection
		conn.connectTimeout = 10_000
		conn.readTimeout = 30_000
		conn.setRequestProperty("User-Agent", "tsundoku-app/$running")
		if (conn.responseCode != 200) throw java.io.IOException("HTTP ${conn.responseCode}")
		return conn
	}

	private fun fetchText(url: String): String = open(url).inputStream.use { it.readBytes().toString(Charsets.UTF_8) }

	/**
	 * Where PackageInstaller answers. Android asks the person first when it
	 * must: that is STATUS_PENDING_USER_ACTION, whose intent is the system's
	 * own "Update this app?" screen.
	 */
	class Answer : BroadcastReceiver() {
		override fun onReceive(context: Context, intent: Intent) {
			val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
			if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
				@Suppress("DEPRECATION")
				val ask = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
				context.startActivity(ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
				return
			}
			current?.answered(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
		}
	}

	companion object {
		private const val KEY_CHECKED = "checkedAt"
		const val ACTION = "dev.masshiro.tsundoku.UPDATE_ANSWER"

		/** The activity's updater, for [Answer]: a receiver has no other way back to it. */
		@Volatile
		var current: Updater? = null
	}
}
