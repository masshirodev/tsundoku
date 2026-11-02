# Nothing is minified (a WebView wrapper with no dependencies of its own), so
# these rules only keep the JavascriptInterface method's name: @JavascriptInterface
# methods are looked up by name from the page.
-keepclassmembers class dev.masshiro.tsundoku.tv.* {
	@android.webkit.JavascriptInterface <methods>;
}
