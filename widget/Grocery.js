// Grocery list widget for the free Scriptable app (https://scriptable.app). Read-only: it shows what is still to buy.
// Setup is in widget/README.md. Run this script once inside Scriptable; after that it runs as a widget.
// Nothing personal lives in this file: the API address, the pasted link and the widget's own sign-in
// token are kept in the iOS Keychain on your phone.

const KEY = "grocery-widget";
const MAX_LINES = { small: 3, medium: 4, large: 12 };

function load() {
  try {
    return Keychain.contains(KEY) ? JSON.parse(Keychain.get(KEY)) : null;
  } catch (e) {
    return null;
  }
}

async function ask(title, message, placeholder) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addTextField(placeholder, "");
  alert.addAction("OK");
  alert.addCancelAction("Cancel");
  if ((await alert.present()) === -1) return null;
  return alert.textFieldValue(0).trim();
}

// Joins the household with an invite, like a second phone would. The widget then shows up as its own
// device ("Widget") in the app's Settings, where you can remove it at any time.
async function setup() {
  const api = await ask("API address", "The address of the Grocery API (the same one the app uses).", "https://...");
  if (!api) return null;
  const link = await ask("Invite link", "In the app: Settings, Create invite link. Paste it here.", "https://...#join=...");
  if (!link) return null;
  const match = /join=([\w-]{8,100})/.exec(link) || /^([\w-]{8,100})$/.exec(link);
  if (!match) throw new Error("That is not an invite link.");
  const base = api.replace(/\/$/, "");
  const req = new Request(base + "/join");
  req.method = "POST";
  req.headers = { "content-type": "application/json" };
  req.body = JSON.stringify({ code: match[1], deviceName: "Widget" });
  req.timeoutInterval = 15;
  let creds;
  try {
    creds = await req.loadJSON();
  } catch (e) {
    throw new Error("That API address did not answer like the Grocery API. Check it and try again.");
  }
  if (!creds.token) throw new Error(creds.error || "Could not sign in. Ask for a new invite link.");
  const saved = { api: base, token: creds.token };
  Keychain.set(KEY, JSON.stringify(saved));
  return saved;
}

async function fetchList(saved) {
  const req = new Request(saved.api + "/sync");
  req.headers = { authorization: "Bearer " + saved.token };
  req.timeoutInterval = 15;
  const data = await req.loadJSON();
  const status = req.response.statusCode;
  if (status === 401) {
    Keychain.remove(KEY); // the device was removed: the next run asks for a new invite
    return { signedOut: true };
  }
  if (status !== 200) throw new Error("The list answered with " + status);
  const stores = new Map((data.stores || []).map((s) => [s.id, s.name]));
  const items = (data.items || []).filter((i) => !i.checked);
  return { items, stores };
}

function message(text) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  w.backgroundColor = new Color("#1c1c1e");
  const t = w.addText(text);
  t.textColor = Color.white();
  t.font = Font.systemFont(13);
  return w;
}

function build(result, saved, family) {
  if (result.signedOut) return message("Grocery widget signed out. Run the Grocery script in Scriptable to set it up again.");
  const { items, stores } = result;
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const text = Color.dynamic(new Color("#1c1c1e"), new Color("#ffffff"));
  const dim = Color.dynamic(new Color("#6e6e73"), new Color("#98989d"));

  const head = w.addText(items.length ? "To buy · " + items.length : "Nothing to buy");
  head.font = Font.boldSystemFont(family === "small" ? 13 : 15);
  head.textColor = text;
  w.addSpacer(4);

  const max = MAX_LINES[family] || 4;
  for (const item of items.slice(0, max)) {
    const store = stores.get(item.storeId);
    const line = w.addText(family === "small" || !store ? item.name : item.name + "  ·  " + store);
    line.font = Font.systemFont(13);
    line.textColor = text;
    line.lineLimit = 1;
  }
  if (items.length > max) {
    const more = w.addText("+" + (items.length - max) + " more");
    more.font = Font.systemFont(11);
    more.textColor = dim;
  }
  return w;
}

async function main() {
  let saved = load();
  if (!saved && config.runsInWidget) {
    Script.setWidget(message("Open Scriptable and run the Grocery script once to set it up."));
    return;
  }
  if (!saved) saved = await setup();
  if (!saved) return;
  let widget;
  const family = config.widgetFamily || "medium"; // Scriptable's own `config`: how and where the script runs
  try {
    widget = build(await fetchList(saved), saved, family);
  } catch (e) {
    widget = message("Could not reach the list. It will try again soon.");
  }
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

try {
  await main();
} catch (e) {
  const alert = new Alert();
  alert.title = "Grocery widget";
  alert.message = String(e.message || e);
  alert.addAction("OK");
  await alert.present();
}
