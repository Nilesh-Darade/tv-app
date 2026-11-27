# Bright Minds

Bright Minds shows short learning slides in the LG C1 OLED TV browser.

## Start on your TV

1. On your Mac, open Terminal in the Bright Minds folder and run `./serve.sh`. If macOS asks whether Python can accept incoming connections, click **Allow**. Keep Terminal open while you use Bright Minds.
2. Connect the TV to the same Wi-Fi network as the Mac. On the TV, open the **Web Browser** app, type the URL printed in Terminal, and bookmark the page.
3. Choose the browser's **Full Screen** option.

## Remote controls

| Button or action | What it does |
| --- | --- |
| Right arrow or Magic Remote pointer click | Go to the next slide |
| Left arrow | Go to the previous slide |
| Enter (OK), Play, or Pause | Pause or resume |
| Up / Down | Add / subtract 0.2 from the pace multiplier, within 0.5 to 2.5. Higher values give each slide more time. |
| `f` or double click | Toggle full screen where supported |
| Back | Use the TV browser's usual Back action |
| Any key or click while the screen is asleep | Wake the slideshow |

## URL options

Append options to the printed URL. Join multiple options with `&`, as in `?cats=space,math&pace=1.5&sleep=2`.

- `?cats=space,math` shows only Space and Math. Use any of `quote`, `physics`, `math`, `animals`, `space`, and `learn`.
- `?pace=1.5` starts at 1.5 times the normal display duration. Without this option, the app uses your saved pace or starts at 1.
- `?sleep=2` sets the idle timeout to 2 hours. The screen fades to black after 3 hours by default.

## Add or edit slides

Open `content.json` and find the category under `categories`. Edit an existing entry or add one to its `items` array, separating entries with commas.

```json
{"t": "A square has four equal sides.", "d": "If each side is 3 cm long, the perimeter is 12 cm."}
```

Each slide needs non-empty main text in `t`. Use `d` for an optional detail and `a` for a quote's author or proverb attribution. Save the file and reload Bright Minds on the TV.

When you're done, turn the TV off with the remote so the OLED can run its pixel refresh.
