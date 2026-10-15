# Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

Every version's changes are recorded here; installers are on the [Releases](https://github.com/ypyik0669/claude-web/releases) page. Versions follow [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- **The interface now comes in English.** The whole interface (the web app, the desktop menus and tray, the phone page, the pairing page, exported HTML, error explanations) is available in both Chinese and English, and **by default it follows this computer's language**: an English computer gets English, a Chinese computer gets Chinese. To change it: **Settings → Appearance → Language** (Follow system / 中文 / English). The interface reloads once after you change it; the desktop menus and tray need an app restart. The language Claude replies in inside a conversation is not affected.
- **Subagents can use a different model.** Next to the model button in the input box there is now a "Subagent" button. The main task still uses the main model, while subagents (the ones launched by Task or by workflows) use whatever you pick here, so you can choose a cheaper model to save quota. The default is "Same as main model". Each conversation remembers its own choice; tick "New conversations on this provider all do this" at the bottom of the menu and every conversation you start on that provider from now on (including IM and scheduled-task ones) uses it. If you change it in a running conversation, the process restarts quietly in the background and the new setting takes over once the current turn finishes.
- **Several Claude accounts side by side.** **Settings → Account and login → Other Claude accounts → Add account** opens a terminal running `claude setup-token`: sign in to the account you're adding in the browser and authorize, and the token the terminal prints fills in by itself. Give it a name and save (saving sends one very short message as a test). From then on each account is a section of the model menu ("Work / Opus 5.5"), and every conversation picks the account it runs on; when one runs out of quota, pick a model of another and carry on — the conversation is kept. An account can be the default for new conversations, and IM bots and scheduled tasks can use it too. The login in ~/.claude is still "Claude account", as before.
- **Custom styles (custom.css)** (GitHub issue #2). Put your own CSS in `~/.claude-web/custom.css`: it is loaded after the built-in styles, every window picks up a save at once, and the desktop app's auto-update leaves it alone. **Settings → Appearance → Custom styles** creates / edits the file and switches it off in one click. A new file lists the hooks that stay the same in later versions: `html[data-theme]`, `.chat[data-state]`, a plan's `data-done` / `data-total` / `--progress`, each plan item's `data-status`, and more.
- **The plan in the side panel's Task tab has a progress bar**, like a goal's card: "3/7" in its title row with a bar next to it.
- **Click an image in the input box to see it big** (wheel to zoom, arrow keys to move between images); hover it and a × in the corner removes it. A click used to remove it.
- **"Subagent model" at the bottom of the model menu** opens the subagent menu directly (the button next to the model is still there; this is another way in).
- Conversations that aren't running here (after a restart, from history) now have the "time · steps · cost · tokens · cache" line under each turn too: turns that ran in this app from the ledger, turns that ran elsewhere from the answers' usage (no cost). The context ring in the corner of the input box is always there now (a faint ring without a number below 60%), estimated from the last turn for a conversation that isn't running.

### Fixed

- **"Allow everything" went back to "Ask first" after a few turns.** When a conversation's process was reclaimed after sitting idle, the app restarted, or you carried on from the phone, it reopened in "Ask first". Each conversation now remembers the permission mode it last ran in and reopens in it; one with nothing recorded uses Settings → General → Default permissions.
- **"This conversation is being updated elsewhere (terminal or another app)" appeared for no reason.** Claude Code writes a few bookkeeping lines into the record as it exits, and those were taken for new messages from elsewhere. The note now only shows when new messages really arrive.
- **0% cache hits and over a dollar a turn.** Usually the next message came more than 5 minutes later: the prompt cache had expired and the whole context was read again at full price. The line now says "12 min later, the cache had expired", with the reason on hover and a pointer to "1-hour prompt cache" under Settings → Providers → Edit (official runtime).
- **A long conversation stuck on "Loading history…" on a phone on the slow relay.** Only the latest part is sent first now (cut at a turn); "Load earlier history" fetches the rest. Very long conversations on the computer open faster too.

## [0.2.5] — 2026-10-14

### Added

- **Projects can be reordered.** Drag a project's name row in the sidebar to put it before or after another project; the project's ··· menu also has "Move to top / Move up / Move down" (use this on a phone). A newly added project goes to the top instead of landing at the bottom. The order is stored on this computer and changes in all windows at once.
- **When a conversation won't fit the model you switch to, it is compacted first.** If you've chatted a lot on a large-window model (say Claude at 400K) and then switch to a small-window model, the new model can't even read the whole conversation, and compacting fails too. Now, before switching, the app checks: if the conversation is over 80% of the new model's window, it is compacted with the current model first and then switched over, with a line in the conversation explaining what happened.

### Fixed

- **Clicking "Allow" on a tool that needs confirmation (editing files, running commands…) still failed**, with the model saying the tool layer rejected it for lacking `updatedInput`. Every conversation running on our built-in runtime had this problem (relays in OpenAI / Gemini format, and relays that aren't restricted to the official Claude Code); tools that need no confirmation, such as reading files, were not affected. "Allow" works now, including the "Allow" buttons on the phone and in IM bots.
- **Switching models inside one conversation didn't change the context window.** With the official Claude Code runtime, the early-compaction setting is read only once when the conversation starts. When you switch to a model with a different window, the process now restarts in the background and picks up the same conversation.
- The little context ring next to the input box used to show 0 / 0 for "used / total" on hover; it now shows the real numbers.

## [0.2.4] — 2026-10-14

### Added

- **Each model's context window now defaults to the full size.** Before, Claude on a relay was always treated as 200K and auto-compacted at around 175K; a GPT relay really has only 272K, but the engine assumed 1.05M and errored out before compaction could kick in. Now **Settings → Providers → Edit** has a "Context window" section with one row per model; leave a row empty to use the default: Claude on a relay is 1M (Haiku 200K), GPT is 272K, Gemini is about 1.05M, a size written in the relay's model list is used as written, and unknown models stay at 200K. To change one, just type it (272000, 272k and 1m all work). When Codex uses this provider, it also follows the default model's window. Conversations that are already running need to be restarted to pick this up.
- **Filter plugins by status**: under Extensions → Plugins, "Installed" now has "All / Enabled / Disabled" at the top right, and enabled plugins come first.

### Changed

- The built-in runtime is now 2.8.4-cw.4: it compacts according to the context window in the provider settings (see above).
- **Every folder in the sidebar is its own group**, like the official Claude app. Before, if you made a parent folder (say your user directory) a project, the conversations from every folder under it were filed under it; now a project holds only the conversations started in that exact folder. Below the projects comes "Folders": one flat group for each folder that has conversations, most recently used on top. On a group you can directly choose "New conversation here" or "Make a project" (pins it to the top); once there are more than 10, older ones are tucked into "Earlier folders". When two folders have the same name, the name is followed by its parent folder (`app · shop`, `app · blog`).
- **"Deep orchestration" now explains how to use it**: the menu says it is for big tasks (the model splits the work into pieces, hands them to several subagents to do at the same time, and you watch progress in "Background"); turning it on shows a one-line hint, and the input box gives an example.

### Fixed

- **Clicking "Rerun" under your own message opened a new conversation.** Now rerunning the last message (say, the one that just errored) asks again in the original conversation; rerunning an earlier message still forks a new conversation from that point, and the button tooltip now says so.
- **A turn that wasn't finished in Codex showed up here as finished.** When you carried on with the same conversation in the Codex desktop app or command line, a half-done turn was shown here as over ("0s · 3 steps · cost unknown"). It now says "This turn is still running in Codex" and updates by itself when it finishes. For Codex conversations started here, a half-done turn could also be recorded too early, and its second half was then never visible; now it is recorded only once it's done.
- **"Open in File Explorer" did nothing** (Windows): Explorer did open, but its window was hidden. "Open in VS Code" also never worked on Windows. Both work now, and you get a message if the folder no longer exists.
- **Settings → settings.json couldn't be scrolled with the mouse wheel**, only with the keyboard.

## [0.2.2] — 2026-10-13

### Added

- **Background: see the subagents and workflows that are running.** The icon bar has a new "Background" entry: subagents a conversation has launched, workflows that are running and background commands, all on one page. There is a row of cards at the top, one per subagent (name, stage, running / queued / done / failed, what it is doing right now, how many tokens it has used). Above them sits a pixel internet café: the main conversation is the admin at the front desk, and every subagent is a customer. They come in, check in at the desk, sit at their own seat and type away (code scrolls on the screen and the step they just took pops up over their head); when they have nothing to do they go eat instant noodles, have a drink, play a round of a game, use the restroom, visit the smoking area or borrow a power bank, and the moment there's work they head straight back to the seat. When they finish they walk to the desk to pay and get a little receipt (how long they were on, the fee, how many tokens, roughly how much money) and leave. A failed one gets a blue screen, and one that was stopped hears the admin shout "called off". The seat plate shows the café fee (purely for fun; you can change the price in Settings → General), and hovering shows the real tokens and estimated cost. Below are the cards, today's bill, the relationship graph and the activity feed. Click a customer and its own conversation opens next to it: what it read, which commands it ran, what it changed. The side panel's "More" also has a small café that follows the current conversation. The left side lists every conversation with background activity, and you can look back at workflows this conversation ran before.
- **Make a character.** In the "Character library" at the top right of the café you'll find the default little octopus and the admin. Click "Make a character", give it a photo or describe what you want ("a programmer in black-framed glasses and a blue hoodie"), and Claude draws a pixel character for you to see. Keep talking to adjust it ("bigger eyes"), save it when you're happy, and assign it to the admin, to all customers, to one kind of subagent (say Explore) or to a subagent with a particular name. You can also just say "make me a café character that looks like this photo" in any conversation.
- A small "Background" pill now sits above the input box: when a turn has ended but things are still running in the background it stays there, and clicking it opens "Background" directly. The Workflow card in a conversation shows each subagent's status live; the side panel's "Task" has a shrunken relationship graph and a stop button for each task.

### Changed

- **"Stop" now stops only this turn.** Before, pressing stop in the input box also killed background workflows, background subagents and background commands; now they keep running, and to stop them you do it individually on the "Background" page, in the side panel's "Task" or on the card (a workflow is stopped as a whole). If something is still running in the background when you press stop, you get a note about it.
- When a conversation's turn has ended but a workflow or subagent is still running in the background, idle reclaim no longer shuts its process down (before, after 30 minutes idle it closed the process together with the background work, and the workflow's result never arrived).
- The built-in runtime is now 2.8.4-cw.3: after a workflow starts, the turn ends once it has said its piece, and the input box no longer stays stuck on "Running" for the whole workflow (before, pressing stop at that point got no response and reopened the process, taking the background workflow with it); when the workflow finishes, its result starts a turn by itself to tell you.

## [0.2.1] — 2026-10-11

### Added

- **Search now happens in the built-in browser; Tavily is gone.** When an agent searches, the built-in browser opens a search site's results page in a page you can't see and reads the results out, which is the same kind of request as searching in a browser yourself, so no key is needed and no third-party search proxy is involved. By default it tries DuckDuckGo, Bing, Yahoo and Baidu in turn and uses whichever gives relevant results; in **Settings → Web access** you can pick one (Google, Yahoo and Baidu were added), and "Try it" shows which ones work on your network. When a site asks for verification, open it in the browser in the side panel and verify once. In testing (on a network behind a proxy) DuckDuckGo gave relevant results for all three queries within 1–4 seconds; the previous version fetched results pages straight from the computer, and Bing was relevant only once in four tries. Several searches can run at the same time. The web version and the phone (which have no desktop window) still have the computer fetch Bing / DuckDuckGo results pages.
- **Mouse and keyboard on a web page, by position.** For things that can't be listed as elements (a canvas, a map, dragging, hover menus, sliders), the agent can now look at a screenshot of the built-in browser and act by position: click, double-click, right-click, drag, scroll wheel, type, press keys. It only acts on its own tab and goes through permission approval like every other web action.
- **Computer control (Windows).** "Computer control" in the `+` menu now works: the agent looks at screenshots of the screen and uses the mouse and keyboard on the apps you allow (Notepad, File Explorer, desktop software…). Which apps it may use is asked every time with a card that shows the app name and what it says it wants to do; **only clicking "Allow control" on the card counts as consent**, Enter doesn't, and neither "Allow everything" nor "Auto" will consent for you. Once allowed, it can see a screenshot of the whole main screen, but the keyboard and mouse only go out while an app you allowed is in front; Claude Web's own window can never be operated by it. It is on for this one conversation only, and the next new conversation needs it turned on again; the permission is withdrawn when the conversation ends. On macOS and Linux this row still says "Not available right now".

### Changed

- The model now has only one search tool. The one that ships with the runtime used to go through a Tavily proxy hosted by an upstream project by default (your search terms passed through someone else's server); on our runtime it is no longer offered. If you chose a backend for it yourself (`WEB_SEARCH_ADAPTER` or `/web-tools`), that keeps working as before. Conversations running on the official Claude Code are not affected.
- Tavily is gone from Settings → Web access; a Tavily key stored earlier is deleted on startup. A Brave Search key can still be entered.
- Search result summaries no longer start with the URL and a machine-format date.

### Fixed

- For a page that keeps spinning and never finishes loading (say an image that never returns), the agent used to time out when reading it and get nothing; now, if it can't wait any longer, it stops the loading, reads what has already appeared, and says "still loading".
- The browser identification the built-in browser reports to websites no longer contains `Electron` or the app name (some sites showed a verification page on seeing it).

## [0.2.0] — 2026-10-10

### Added

- **Web access: search and the built-in browser.** The agent in every conversation (Claude, Codex, Gemini and so on) can search the web, and can use the built-in browser to open pages, read content, click, fill in forms and take screenshots; just tell it "search for…" or "open this address and take a look". The pages it opens appear in the new "Browser" tab of the side panel, with each conversation's agent using its own tab, so you can see what it is doing; you can also use it to browse yourself (links that want a new window open as a new tab of it), and "send to conversation" the page address and the text you've selected. Search here needs no key by default (Bing, or DuckDuckGo if that fails), and is only a fallback: on many networks they rate-limit or return unrelated results, and the agent prefers its own built-in search first. For something dependable, enter a Tavily or Brave key in **Settings → Web access**. Click, form filling and screenshots need the desktop app; the web version and the phone can only search and read text. Opening and operating pages goes through permission approval; searching doesn't ask.
- **Icon bar and sections.** A new icon bar runs down the far left of the window: Conversation · Automation · Extensions · ···, with Settings and your account below (the ring around the avatar is your quota). Click "Automation" or "Extensions" and the sidebar switches to that section's own content, with its page in the main area. The row of unlabeled panel icons that used to appear after "Show workbench tools" is gone: those panels are now in ···, each with a name and a one-line description, and the ones you use often can be pinned to the icon bar.
- **Extensions page.** Connectors (MCP servers) are a directory: each service has its own logo, a one-line description and an "Add" button; Skills and plugins are here too. The old pages in Settings are all still there.
- **"How deep to think" is its own button.** Model and thinking effort are now two buttons: the model menu only picks the model; the button next to it has one level per row, each with a one-line explanation, and "Deep orchestration" is the switch on the last row.
- **Automation → Scheduled tasks**, when you have no tasks yet, is no longer a line of grey text but an explanation plus six template cards with icons.
- **Interface zoom** (desktop app): when your screen resolution is high and the interface looks small, you can scale the whole interface up (or down), from 50% to 300%. <kbd>Ctrl</kbd>+<kbd>=</kbd> zooms in, <kbd>Ctrl</kbd>+<kbd>-</kbd> zooms out, <kbd>Ctrl</kbd>+<kbd>0</kbd> resets (on macOS it's <kbd>⌘</kbd>; the numpad + − 0 work too), or choose it in **Settings → Appearance → Interface zoom**; it's in the command palette as well. All windows change together and **it is remembered after a restart** (Ctrl+Shift+= used to zoom in too, but every launch went back to 100%). When zoomed in, the window's minimum size grows with it, so the interface won't get squeezed into the phone layout; how far you can go depends on the screen (the window has to fit). The − □ × at the top right and the button next to them never overlap at any scale. For the web version, use your browser's own zoom.

### Changed

- The side panel has five fixed tabs (the Browser was added). When the panel is narrow only the current tab keeps its name and the others are icons; for a panel opened from "More", a name that doesn't fit is no longer cut off in the middle of a character but folded into "More" (a number on the button, and the panel's name written at the top of the panel).
- "Control browser" in the `+` menu is now called "Control Chrome": it uses your own Chrome (the Claude extension must be installed); the built-in browser is there for every conversation and needs no switch.

### Fixed

- **Turning on "Computer control" meant the conversation wouldn't start.** This switch in `+` passed the runtime an argument it doesn't recognize, and the process exited before the first message. The runtime supports computer control only in its own terminal interface, so the argument is no longer passed, that row is marked "Not available right now" with the reason given; for going online (search, opening pages, clicking, screenshots) use the built-in browser above.
- When the project and branch at the top of a conversation didn't fit, they used to be squeezed into an unreadable stub like "m…"; now the item that doesn't fit is hidden entirely, and only the project name itself gets shortened.

### Interface refresh

The whole interface got a new look and feel (the design notes are in `docs/superpowers/specs/2026-10-10-ui-refresh/`). No features or entry points were removed; the only changes in position are the ones listed above under "Added" and "Changed".

- **No longer all squares and boxes.** The sidebar sits directly on the warm background, while the conversation area, the side panel and the settings pages are rounded cards floating above it with a gap between them; the dividers and outlines that used to be everywhere are replaced by a very faint shadow ring. The corner radii of the input box, menus, dialogs and cards follow one unified set of sizes.
- **Color**: light is a warm paper white, dark is a warm black, and the accent is a bright orange (used only for the brand, focus and the glow of things that are running). The other four themes (Paper, Dracula, Nord, Tokyo Night) were adjusted to match.
- **Fonts**: interface text is Inter and code is JetBrains Mono (both ship with the app, nothing to install), Chinese still uses the system font; the home greeting and page titles use a serif. Font sizes are unified into one set of whole numbers.
- **Icons** are all replaced with Lucide line icons, with stroke weight adjusted to size.
- **Input box**: the send button is a circle that changes (grey when empty, solid when there's content, a stop square while running); while running, a travelling glow runs around the input box, and a status tab on the top edge says what it is doing, which step it's on and how long it's taken.
- **Conversation**: the steps of a turn are one line each, and consecutive steps of the same kind (several files read in a row) merge into one line; new steps slide in and collapse into a one-sentence summary at the end, with times and numbers rolling up; the reply text fades in. Code blocks, the changed-files card and tables were redrawn.
- **Menus, segmented controls, notices**: menus grow from where you clicked; a pick-one-of-two-or-three choice in Settings is a segmented control with a slider; notices ("Copied" and the like) moved from the bottom right to the top of the main area as small ink-colored pills, at most three stacked, so they no longer cover the input box and the approval buttons.
- **Approval card** (the one for when Claude wants to run a command or change a file) has larger corners, the command in a block of its own, and pill-shaped buttons.
- **Phone**: the header is floating round buttons (with an extra `+N −M` when there are changes, which you tap to see them) and the content scrolls underneath; the side panel is a draggable bottom sheet (two heights, pull down to close); swipe right on a conversation to pull out the sidebar and left to put it away; on a phone every menu slides up from the bottom as an action sheet, and long-pressing a conversation row opens one too; the system back gesture closes the topmost layer first (menu, sheet, sidebar) instead of leaving the page; tap a step in the conversation and its details open in the sheet; the approval card's buttons each take a row; above the terminal there is a new row of Esc / Tab / Ctrl / Alt / arrow keys / Ctrl+C / Paste; in Review you can toggle word wrap and horizontal scrolling, and commit is folded into one button; everything tappable has a tap target of at least 44px. These gestures have only been tried on a computer with a phone-width window and simulated touch, **and have not yet been verified on a real phone**; if something feels off, please open an issue.
- The phone shell (the page you get when connecting back from outside) and the LAN pairing page use the same colors now.
- A message sent while a turn is running is now a small card above the input box saying "Queued; it will be sent when this turn ends", and you can edit it, send it now or delete it.
- Settings → Appearance has a new "Haptic feedback" (on phones that support vibration, a light buzz on send, on approve and when a long press opens a menu).
- With the system's "reduce motion" on, or "Reduce motion" on in Settings, none of the animations above appear (except the spinning loading mark).
- Desktop app (Windows): the − □ × at the top right float over the cards and sit roughly in line with that row's own buttons (they used to sit a bit higher); when viewing an image, the buttons on the right of the toolbar are no longer covered by − □ ×.

## [0.1.10] — 2026-10-09

### Fixed

- **The row of buttons on your own messages (Copy, Edit, Rerun, Fork, Share) was always hard to click.** ([#1](https://github.com/ypyik0669/claude-web/issues/1)) They used to float in the empty space above the message, and when you moved the mouse up from the message, the buttons vanished the moment it left the message. Now the buttons sit below the message, like the ones under a reply, and stay there as you move the mouse over to them.

## [0.1.9] — 2026-10-09

### Fixed

- **A code block sometimes showed only "12 lines" with blank space below.** We couldn't reproduce it here; it looks like a browser extension or page translation altering the page. Now a code block checks itself: when it has content but displays as empty, takes up no space, or has text the same color as the background so it can't be seen, it redraws once first, and if that still doesn't work it falls back to plain text without highlighting and writes the circumstances to the log (only things like line count, language and browser, never the code itself), so next time it can be traced.
- **On an OpenAI-format relay, choosing a model with sonnet / opus / haiku in its name (such as `claude-sonnet-5`) actually sent the default model.** Now the models the relay lists itself are sent as they are. The runtime is updated to 2.8.4-cw.2 with this.
- The runtime's built-in `update` command used to go and install from npm a package that doesn't exist on npm; now it just says the runtime updates together with Claude Web.

## [0.1.8] — 2026-10-09

### Added

- The row under every reply now shows the cache hit rate ("Cache 92%"), and hovering shows how much of the input was read from the cache, how much was written to it and how much didn't go through the cache. Input (↑) now also counts the part written to the cache, using the same calculation as "This conversation's usage" and the ledger.
- The model menu and the model name below the input box now use the names that come with the provider's model list: the official DeepSeek's `deepseek-flash` shows as "DeepSeek-V4.1-Flash" (the real id is still written under that row in the menu). For providers you've already added, click "Refresh all models" once to update.
- **Every provider and every model can now pick a "Thinking effort".** Before, only Claude could; providers in OpenAI / Gemini / Grok format never sent this setting at all. Now a model that supports it uses its own parameter (DeepSeek's `reasoning_effort`, Gemini's thinking level…, with the levels taken from the provider's model list), and one that doesn't has the request written into every turn's prompt; if a relay doesn't accept the parameter, it is removed and re-sent automatically, the turn is still answered, and the app remembers to use the prompt approach for that model from then on. Changing the level doesn't require reopening the conversation.
- **"Deep orchestration" now works on every model**: once it's on, the model writes a workflow for bigger tasks and hands the pieces to several subtasks (this uses more tokens). Turning it on in the welcome page and then sending works too.
- The runtime is now claude-web-engine, which we maintain ourselves (a modification of claude-code-best 2.8.4); it ships together with Claude Web and is no longer updated separately.

### Fixed

- **The rules behind "Auto" were never actually loaded.** The previous runtime dropped the rule text used for the judgement when it was packaged, so the judging was left to the model's guesswork; now the complete rules are used.
- **On the official DeepSeek, "Auto" no longer asks you about every single command.** Before running a command, "Auto" first has the model judge whether it's safe, and this step requires the model to call a judging tool; DeepSeek rejects that kind of request in thinking mode ("Thinking mode does not support this tool_choice"), so every judgement failed and it had to ask you every time. Now when this step meets that rejection, it turns thinking off and asks again automatically, and does it that way from then on. The DeepSeek member in the model gateway is the same.
- **A question asked on the phone (or in another window) is now shown on the computer too.** Before, only the reply showed up and you had to reopen the conversation to see the question; the same went for bots like DingTalk, scheduled tasks, and the "continue" that goals send automatically.
- When a "Claude account" conversation fails because the key was rejected or it couldn't connect, and you have already added a provider, it now says this conversation didn't go through your provider, and offers a "Retry with “provider name”" button.
- When the server can't be reached, the retry line no longer says just "(unknown)": it says "Can't reach the server", and explains that the specific reason is shown only after the retries finish, and that you can click "Test connection" to find out right away.
- When the computer's name is very long (over 64 characters), the name shown on the phone before and after pairing is now the same.
- When Codex uses a provider (relay), the ledger no longer records calls that were answered normally as failed ("client disconnected"): Codex disconnects as soon as it has the answer, and these calls used to be counted as failures. The conversation identifier sent to the relay is also now consistent with Codex's own.

## [0.1.7] — 2026-10-07

0.1.6 was never published on its own; everything under 0.1.6 below is in this version too.

### Fixed

- **Conversations opened with a provider (relay) are no longer overridden by old settings in `~/.claude/settings.json`.** Before, people who had used a tool like cc-switch, or had written a relay address and key into the `env` of `settings.json` by hand, ran into this after adding a new provider here: the model list could be fetched (that was done here with the new key), but sending a message got "API retry 1/10 (authentication_failed HTTP 401)" and took several minutes to fail. The cause was that Claude Code used the old key (even the old address) from `settings.json` over the one given by this app. Now conversations and "Test connection" both go by what's entered in the provider; the other settings in `settings.json` still apply as usual, and conversations opened with a Claude account still read it as before.
- When a key is rejected (401), the first retry now says right away what to check, without waiting for all ten retries to run.

## [0.1.6] — 2026-10-03

### Added

- **Reach your computer from your phone even when you're not on the home Wi-Fi.** **Settings → Phone and other computers** has a new "Use it from anywhere" option (on by default when remote access is on). The pairing QR code now defaults to the "works anywhere" one: scan it, the phone opens a web page, you pair once, and from then on you can connect from anywhere, with no app to install and no sign-up.
  - The two sides find each other through a public rendezvous server, all messages are encrypted, and the rendezvous server only sees the encrypted data and both sides' IPs.
  - It connects directly when it can; on mobile data that often doesn't work, and then it switches automatically to a slower relay path: text and approvals work, file preview and upload don't, and the phone says so.
  - The old LAN QR code is still there ("Local network only (no internet needed)").
  - iPhone: to use it from a Home Screen icon, first "Add to Home Screen" and pair from there (the Home Screen and Safari have separate storage); on the phone page you can paste the link you get from "Copy pairing link" on the computer.
  - After a device is revoked, any channel it already has open is cut immediately.
  - The rendezvous server, STUN server and phone page address can be changed under "More options", and the last 20 connections are there too. A changed list is written into the QR code and the phone picks it up when scanning; after a change, phones that are already paired need to scan again.
- **Keep the computer from sleeping while remote access is on** (desktop app, on by default). The screen still turns off, and a laptop with its lid closed still sleeps. The web version can't do this, and Settings says so.

### Notes

- **If you already had remote access on, "Use it from anywhere" and "Keep the computer awake" turn on automatically after upgrading** (both are on by default). The computer stays connected to the public rendezvous server waiting for the phone to look for it, and doesn't fall asleep on its own while remote access is on: this makes little difference on a desktop or a laptop plugged in, but a laptop on battery will use more power than before (the screen still turns off and closing the lid still sleeps). If you don't need them, turn the two switches off in **Settings → Phone and other computers**, or just turn off "Allow other devices to connect".
- **When one phone is paired with several computers, those computers can read each other's access tokens on that phone** (the "works anywhere" phone page has the same URL, and the interfaces of several computers run inside it). Pair only computers that trust each other to the same phone; pairing with the "Local network only" QR code is not affected.

## [0.1.5] — 2026-10-02

### Fixed

- **Switching provider in a new conversation before sending a message no longer gives "No conversation found with session ID".** Before, if in a new conversation you first switched in the model menu to a model from another provider (relay), the conversation immediately became "Error" and switching back didn't help. The cause was that the conversation had no record file yet, but switching tried to reopen it as "continue the earlier conversation". Now a conversation that has never had a message restarts within the same conversation. Sending a message after a new conversation has sat idle for half an hour, or switching models in a new conversation and triggering a restart, was the same problem and is fixed too.
- **Errors now start with a one-sentence plain explanation of what went wrong.** In the red text in conversations, in pop-ups and in `server.log`, common errors (folder not found, connection refused, wrong key, insufficient balance, region restriction, rate limiting, conversation too long…) first say what the problem is and what to do, with "Original: …" kept below so the raw error is visible in screenshots or when reporting a problem. Pop-ups stay a few seconds longer and the text can be selected and copied.
- When a conversation's project folder has been moved or deleted, it now says outright "Can't find this conversation's project folder" instead of suggesting you test the provider.
- **After switching provider, other windows immediately show the new model and "Starting".** Before, they sat on "Closed" and the old model for ten-odd seconds up to half a minute, and messages sent in that time were still delivered to the old provider.
- **Messages sent during the second or two of a provider switch are no longer refused or dropped.** The message waits until the new process is up and then goes out; opening the same conversation in another window at that moment also no longer quietly cancels the switch. If you switch while it is answering, this turn ends clearly with the note "Switched. This turn was interrupted."
- **Switching provider back and forth between the official Claude Code and ccb no longer loses the turns in between.** Before, turns that ran on ccb were invisible after switching back to the official Claude Code, and the next turn would also fork off from an earlier point. Continuing a web conversation in the terminal with `claude --resume` had the same problem and is fixed too.
- **New models such as Claude Opus 5.5 work on Claude-format relays.** Before, choosing one gave a 400 "requires adaptive thinking": the built-in ccb was too old to know these models. Now these models automatically run on the official Claude Code; if the conversation uses a feature only ccb has, it stays on ccb, just without thinking.
- **Cost is no longer added up repeatedly.** Before, each turn added the conversation's whole cost so far again, so a conversation that really cost $2.42 showed $17.42, and every turn in the ledger was recorded under the first model the conversation ever used. Now each turn records only its own cost and model.
- **Changing "Thinking effort" on ccb really takes effect now.** Before, you changed the level in the interface but what actually went out was still the old one. Now the conversation is reattached with the new level; if it's answering, the change waits until this turn ends. Relays in formats other than Claude (OpenAI / Gemini / Grok) never sent the level anyway, and the option is no longer shown for them.
- **You can now see the reason for errors reported by a relay.** Errors like insufficient balance or no available account used to show only "403 status code (no body)". "Insufficient account balance" is now described as insufficient balance, no longer as no permission.
- **Test connection is faster and failure reasons are clearer.** When a relay kept returning 5xx, it used to take 4 minutes to produce just "exit 1". Now it retries only once, a timeout says timeout outright, and for a relay outage or insufficient balance it no longer wastes time re-testing with the official Claude Code. A key that only works for image models now says "No chat models in the list" directly, and those models no longer appear in the model menu. Test connection also no longer leaves conversations like "Reply with exactly: ok" under "Other folder › Temp".
- **Switching back to "Claude account" really switches back.** Before, the interface said "Claude account" but the old provider was still the one answering, and still being charged.
- **For accounts that configured a relay by hand in `~/.claude/settings.json`, the default model no longer gets stuck.** Before, it was replaced with a model name the relay doesn't have, and hung for over three minutes before erroring.
- **Handing back to Claude from Codex (or another agent) no longer errors on the first message on ccb.** After handing back and reopening, the conversation is also no longer treated as a Codex conversation.
- **Continuing, in the terminal, a conversation that is open on the web no longer makes the web side miss those turns or lose them.** When a web conversation ran on the official Claude Code and was idle, `claude --resume` in the terminal couldn't see the web side's last reply; that is fixed too.
- An insufficient-balance error is no longer described as "quota used up, wait for the reset": it now says plainly that the provider account's balance is too low, so top up or switch provider; and "auto-continue when the time comes" no longer applies to it.
- When the process exits and the CLI output contains a more specific reason (not signed in, not a git repository, wrong key…), that reason is stated first instead of just "exit code 1".
- A turn interrupted by a provider switch no longer leaves an empty ledger row with no model and no usage.
- During Test connection, if reading the model list hits a dropped connection (disconnect, connection timeout), it retries once automatically instead of immediately reporting "wrong address".
- After handing back from Codex and the like to Claude, the conversation's title in the sidebar no longer shows as "# Conversation handoff …".
- A relay's qwen model (which returns an empty `reasoning_content`) no longer has its reply cut down to the first word.
- **For a Codex conversation opened on the web, turns continued with the Codex command line (`codex exec resume`) now show up on the web too.** The window that has this conversation open refreshes automatically; continuing on the web afterwards also keeps the right order.
- A Codex conversation open on the web releases its thread after two minutes idle, so `codex exec resume` in the terminal no longer reports "already has an active writer". If it was added to the conversation library before Codex ever ran, its conversations can be seen afterwards as well.
- When a conversation process errors, the error message now includes the reason the CLI itself printed (before, only "exited with code 1"), and `server.log` records the CLI's output too.
- When switching provider, the old CLI process ends immediately. Before, on Windows it kept running for a few more seconds, and in that time it could finish a turn for the old provider and charge for it with nothing visible in the window; occasionally it also reported "Session ID … already in use".
- A reopened Codex conversation shows the model it used; a fork of a fork has just one "(Fork)" in its title; renaming a conversation that has never had a message now explains in plain language that you must send a message first; the default model now picks the newest GPT (such as gpt-6.1), and among same-name entries that differ only in case, the lowercase one is preferred.

## [0.1.4] — 2026-10-01

### Fixed

- **When a conversation's process errors, it now says clearly what went wrong.** Before, if the process behind a conversation errored and exited right at startup, the interface kept showing "Thinking" with only an English "session … is error; reopen it to continue" popping up, and nothing was written to the log. Now:
  - the conversation shows the cause in red and the turn simply ends instead of spinning forever;
  - the pop-up is in plain language, with the cause and what to do;
  - the cause is written to the log (a `process failed:` line in `server.log`), so sending the log when you report a problem is enough to see it;
  - sending again in the errored conversation reopens it automatically.

### Documentation

- The README section "Connecting a third-party API / relay" gained screenshots of adding a provider quickly and of the model menu.

## [0.1.3] — 2026-09-30

### Added

- **The app checks for updates by itself and shows a pop-up when there's a new version.** Before, you only found a new version by opening **Settings → Advanced → Update** and clicking "Check for updates". Now it checks automatically after startup and every 4 hours:
  - **Windows installed version**: downloads the new version in the background, then pops up "Restart to update / Later"; choose "Later" and it installs by itself the next time you quit the app.
  - **macOS version and Windows portable version**: they can't install updates themselves (the macOS version has no Apple signature), so the pop-up gives the download link that fits this computer.
  - Important versions are marked as required, and the pop-up then has no "Later".
  - If you don't want automatic checks, turn them off in **Settings → Advanced → Update**.
- This changelog.

Note: automatic checking takes effect from this version; v0.1.2 and earlier need one last manual download and install of v0.1.3.

## [0.1.2] — 2026-09-30

This version mainly looks after two kinds of people: those who have no Claude account and only use relays or domestic Chinese models, and those running a proxy (rule mode).

### Added

- **Connect a model the first time you open the app, no Claude account needed.** The first step of the first-run guide is now "Connect a model": pick a relay, DeepSeek, Kimi, Zhipu, Tongyi, SiliconFlow, OpenRouter or Gemini, paste the API key, and click connect. The app first reads the model list, works out the format and the default model by itself, and then sends one very short test. When it fails it says the reason outright (wrong key, insufficient balance, wrong address, can't connect…). Signing in with a Claude account is still possible and sits in a secondary place on the same page.
- **Network proxy.** New **Settings → Providers → Network proxy**. The default is "Follow system": it first looks at the `HTTPS_PROXY` environment variable at startup, then reads the system proxy (Windows system proxy / PAC, macOS network settings). A proxy tool that only turns on the "system proxy" and not global mode now works: Test connection, fetching model lists, all conversations (including other agents such as Codex), IM bots and the built-in terminal all go through it, while local and LAN addresses still connect directly. A stale proxy left behind after the proxy tool quits is skipped automatically. You can also choose "Don’t use", or enter a custom HTTP proxy address.
- **IM bots, scheduled tasks and other agents can all use your providers.** New conversations default to the one set as default in **Settings → Providers**; each bot can pick "which provider to use" on its own, and each agent's (Codex, Gemini CLI…) card also lets you choose which provider "New conversations use".
- **Codex works with relays that only have chat/completions.** Most Chinese relays and vendors don't have the `/v1/responses` endpoint Codex needs; the app now converts automatically and remembers that this relay doesn't support it.
- **Agents installed elsewhere are found.** The codex bundled with the Codex desktop app or the VS Code / Cursor extension, and commands installed through fnm / pnpm / Volta / scoop, are all found; if one is found but errors when run, the error is shown instead of "not installed".

### Fixed

- When you use the Claude CLI in a terminal, or keep sending messages in Codex, the conversation open here now updates live (before, it only caught up after a restart).
- Codex conversation "Failed to load history: thread not loaded": it now reads in a different way; if it still can't be read, it says why and removes it from the list. Conversations already deleted in Codex are no longer listed.
- When an OpenAI-format provider had been marked "only accepts the official binary", all its models were greyed out in the menu; now that mark is ignored.
- When Test connection hits a region restriction ("Access from this region…"), the hint now tells you to check the network proxy instead of saying "wrong API key".
- The home page now shows the "List your Codex conversations here" prompt from the start (before, you had to finish the getting-started checklist or wait 3 days).
- The description of "Show workbench tools" now says outright: adding a provider or switching models doesn't require turning it on.

## [0.1.1] — 2026-09-30

A bug-fix release, mainly for the problem of showing "Thinking" forever and not stopping even when you click stop on OpenAI-compatible relays, and for users without a Claude account whose terminal exited as soon as they opened it.

### Fixed

- **Stop always stops.** When the conversation process is already gone but the interface still shows "Running", clicking stop ends the turn directly; when the runtime doesn't respond to an interrupt within 8 seconds, its process is killed and the same conversation is reattached, with no history lost.
- **A notice when the upstream never answers.** When no reply at all from the model has arrived for 3 minutes in a turn, it says the provider may not be responding and offers an "Interrupt" button. It also fixes a false "may be stuck" warning that appeared right away when you sent a message after more than 3 minutes of silence.
- **Third-party providers work when the computer has a system proxy set.** When `HTTP_PROXY` / `HTTPS_PROXY` is set, requests to the local cache-optimization service (127.0.0.1) now bypass the proxy automatically.
- **The terminal and the "Install" button work without a Claude account, with only a relay.** The terminal panel is now an ordinary command line (cmd on Windows, your default shell on macOS / Linux), and you can still type `claude` in it; "Sign in in the terminal" runs `claude auth login`.
- **OpenAI-compatible providers send requests for the model you chose.** Before, picking another model in the menu, or configuring haiku / sonnet / opus mappings, had no effect.

## [0.1.0] — 2026-09-29

The first public release: a visual workbench for Claude Code, usable as a desktop app or in the browser, and the same interface can also drive CLI agents such as Codex, Gemini CLI, Qwen Code, Kimi and OpenCode.

### Main features

- **Conversation**: streaming output; a finished turn folds into a one-line summary, ending with a changed-files card; permission cards sit above the input box, and pressing Enter on an empty box means allow once.
- **Side panel**: Review (per-file diff, stage, revert, commit), file tree and full-text search, terminal, tasks.
- **Workbench**: split the screen when needed (up to 6), tabs, groups; built-in Monaco editor and browser.
- **Providers and models**: the official account, Anthropic-compatible relays, OpenAI / Gemini / Grok interfaces, all in one model menu; a local model gateway provides multi-account failover and protocol conversion; prompt-cache optimization for third-party models.
- **Multi-agent**: Codex, Gemini CLI, Qwen, Kimi, OpenCode and any ACP agent; a conversation can be handed off to another agent to continue; their conversation history on this computer can also be listed in the same sidebar.
- **Automation**: scheduled tasks, goals (have it advance turn after turn until done), multi-agent orchestration (parallel runs, separate copies, approval nodes, compare).
- **Remote**: scan-to-pair phone access, SSH tunnels, conversations on other computers, Telegram / Discord / Slack / DingTalk / Feishu bots.

[0.1.7]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.7
[0.1.6]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.6
[0.1.5]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.5
[0.1.4]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.4
[0.1.3]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.3
[0.1.2]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.2
[0.1.1]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.1
[0.1.0]: https://github.com/ypyik0669/claude-web/releases/tag/v0.1.0
