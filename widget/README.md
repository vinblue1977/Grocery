# iPhone widget

A read-only widget that shows what is still to buy, built with the free [Scriptable](https://scriptable.app) app. It costs nothing and needs no backend change: the widget signs in like a second phone and appears as the device "Widget" in the app's Settings, where you can remove it any time.

## Set up (once per phone)

1. Install Scriptable from the App Store.
2. In Scriptable tap +, paste the contents of `widget/Grocery.js`, and name it Grocery.
3. In the Grocery app: Settings, Create invite link, and copy the link.
4. Run the script in Scriptable (the play button). Enter the API address (the one the app uses), then paste the invite link.
5. Long-press the Home Screen, tap +, pick Scriptable, add a small, medium or large widget, tap it, and choose the script Grocery.

The widget refreshes about every 15 minutes (iOS decides the exact timing). Tapping it opens Scriptable, not the app: iOS cannot open a Home Screen web app from a widget (links open in Safari), so open Grocery from its own icon. If it ever says it signed out, run the script again to set it up with a new invite.
