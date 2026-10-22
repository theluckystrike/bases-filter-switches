# Bases Filter Switches

Bases Filter Switches puts a row of one-click switches under the toolbar of a base. Each switch is a saved filter, such as "Todo" for `status == "todo"`. Click it and the base shows only those notes. Click again to remove the filter. You do not open the filter editor, and you do not need one view for each mix of filters.

Each switch changes the base file filters, not one view.

The free version gives each base one group of up to 3 switches and one quick property filter. Pro removes the switch limits, allows up to 5 quick filters, and adds presets with commands, default switches, and switches from property values.

## Features

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/bases-filter-switches.gif" alt="Clicking Todo, then Doing, then All, then Done above a base of tasks; the rows change after each click" width="720">

Pro costs $15 one time or $5 a month. Choose [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=bases-filter-switches) or the [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-filter-switches).

### Switches above a base

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/base-file.png" alt="A base of tasks with the Todo and Doing switches on, showing 7 of 10 notes" width="720">

Switches come in groups, for example a Status group with Todo, Doing and Done. The plugin joins switches of one group with "or": Todo and Doing together show the notes that are todo or doing. It joins different groups with "and".

Each switch is a real filter. When a switch is on, its filter is in the top-level filters of the base, next to the filters you wrote yourself. The plugin does not change the text of your own filters. A top-level filter that is not an "and" list becomes the first item of a new "and" list.

### Pause and resume a group

Select "Pause" beside the group name to remove that group's active filters. Select "Resume" to put the saved selection back. The base file keeps the paused labels, so you can close and reopen it before you resume. This control is free.

"All", a switch click, a preset or the default replaces a saved pause. Other groups and view filters stay as they are.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/pause-group.png" alt="The Status group is paused and offers a Resume button" width="720">

### Quick property filter

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/quick-filter.png" alt="The quick filter chip area: work in the bar, and the base shows only the 5 work notes" width="720">

Select the filter button at the end of the bar, or run "Filter the current base by a property". Choose a property from your vault, then "is" or "contains text", then a value. For "is", the list shows the values that notes have now. The filter goes to the end of the top-level filters and shows as a chip, such as `author: Le Guin`. Select × on the chip to remove it. "Clear quick filters" in the Presets menu or as a command removes all of them.

The chips stay in the plugin data, not in the base file. Presets and default switches do not save quick filters. A quick filter edited by hand becomes a normal filter. The free version has one quick filter at a time, so a new one replaces the old one. Pro joins up to 5 with "and". The window works with Tab, the arrow keys, Enter and Escape.

### Embedded bases

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/embedded-base.png" alt="A note with an embedded base and the Done switch on, showing 3 notes" width="720">

A base embedded in a note with `![[Tasks.base]]` gets the same switches under its toolbar. Each note that embeds this base shows the same filter.

### Add a switch without writing YAML

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/add-switch.png" alt="The Add a filter switch window with fields for the group, the label and the filter" width="720">

Select the + button, or run "Add a filter switch to the current base". Type a group, a label and a filter. The filter uses the same syntax as the filter editor, for example `status == "todo"`. You can also pick a top-level filter that the base already has, and that filter becomes a switch. On desktop, right-click a switch to edit or remove it.

### Theme colors and keyboard

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/light-theme.png" alt="The switch row in the light theme with the Doing switch on" width="720">

The switches take their colors from your theme, in light and dark mode. A switch that is on has the accent color. Press Tab to reach the row. Use the arrow keys, Home and End to move between buttons. Press Enter or Space to toggle a switch.

### Switches from the values of a property (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/property-values.png" alt="An Area group with one switch for each value of the area property: home, learning and work" width="720">

Run "Add switches from the values of a property" and choose a property such as `area`. The group gets one switch for each value that notes have now, and new values show up by themselves. For a property with list values, the switches use `list(property).contains(value)`. You can make the group "one at a time", so a click on one switch turns the others off.

### Presets (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/presets.png" alt="The preset Open work applied from its command: Todo, Doing and work are on and the base shows 4 notes" width="720">

A preset saves which switches are on, in each group, under one name. Choose it from the Presets menu to set the switches of each group at once. Each preset also gets a command, so you can give it a hotkey.

### Default switches (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/default-switches.png" alt="A base of tasks after the command that applies the saved default: Todo is on again and the base shows 5 notes" width="720">

Select "Save switches as the default" in the Presets menu to save the switches that are on now. "Apply the default switches", in the menu or as a command, turns them back on. "Clear the saved default" removes it.

## Install

Open Settings, then Community plugins, then Browse, and search for "Bases Filter Switches". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put the three files in `<vault>/.obsidian/plugins/bases-filter-switches/`. Reload the list of community plugins, then turn on Bases Filter Switches.

Bases Filter Switches needs Obsidian 1.13.4 or newer and the Bases core plugin. The app checks for this update use desktop Obsidian 1.14.4.

## Usage

1. Open a base and select "+ Filter switch" under the toolbar.
2. Add a switch, for example group "Status", label "Todo", filter `status == "todo"`.
3. Click the switches to filter the base. "All" turns off the switches of the group.

The base file keeps the switches under the key `filterSwitches`. Core Bases ignores this key and keeps it when it saves the file. You can edit it by hand:

```yaml
filterSwitches:
  groups:
    - name: Status
      switches:
        - label: Todo
          filter: status == "todo"
        - label: Done
          filter: status == "done"
```

## Pro

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/pro-settings.png" alt="The Pro section of the settings after sign in, with the GitHub account and the Pro status" width="720">

Sponsor through the links above, then sign in in the plugin settings.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-filter-switches/HEAD/docs/settings.png" alt="Settings with the Pro section and the add button setting" width="720">

| Setting | Default | Allowed values |
| --- | --- | --- |
| Show the add button on bases without switches | On | On or off. Off also hides the filter button there. |

The Pro section shows your GitHub account, the Pro status, and the Sign in, Refresh and Sign out buttons.

## FAQ

### Where is the state of the switches saved?

In the filters of the base file. A hand-typed filter that matches a switch shows that switch as on.

### Does it change the rest of my base file?

It edits only the top-level `filters` and its own `filterSwitches` key, and it keeps your comments, key order and quotes. Core Bases rewrites the whole file when you change a view, and removes its comments.

### Do base code blocks get switches?

No. The plugin only edits base files. Embed a base file with `![[name.base]]`.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Bases Filter Switches makes no network requests. Sign in uses the GitHub device flow. Bases Filter Switches sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Bases Filter Switches sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [bases-filter-switches](https://notemods.com/plugins/bases-filter-switches/).

Report a bug or ask for a feature in the issue tracker of this repository. Include your Obsidian version and the `filters` and `filterSwitches` parts of the base file.

To build from source:

```
npm ci
npm run build
npm test
```

## License

MIT

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
