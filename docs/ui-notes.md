# CargUI interface notes

## Visual direction

- **Palette:** orange primary (#D68643) with a slightly darker accent for status text, contrasted against charcoal button blocks (#1C1C1E).
- **Typography:** rusty-textured font for title ("cargUI").
- **Buttons:** all command buttons are black blocks with the orange accent text, matching the whiteboard note. Disabled buttons fade to 40 % opacity instead of changing color so the palette stays intact.
- **Window sizing:** minimum window size set to 920 × 680, slightly larger than the macOS Calculator (programmer mode) footprint, as requested.
- **Background:** the actual window background is the orange brand color; the working surface sits on an elevated light card to keep contrast with the text fields and log view.

## Layout structure

```text
┌───────────────--------- Main window ------------─----------───┐
│ \─────────────────────Elevated surface ──----───────────────/ │
│ │ ┌─────┐                                                   │ │
│ │ │  C  │                 cargUI                    [ ⚙ ]   │ │
│ │ └─────┘                                                   │ │
│ │ ^ (c for cargo.. round button for selecting workspace...) │ │
| |                                                           | |
│ │  cargo args.     [ ________________________________ ]     │ │
│ │  program args.   [ ________________________________ ]     │ │
│ │   ____________________________________________________    | |
| |  [_________ DEBUG _________|________ RELEASE__________]   │ │
│ │   _______________________    _________________________    │ │
│ │  [                       ]  [                         ]   | |
| |  |          Build        |  |          Run            |   │ │
│ │  [_______________________]  [_________________________]   │ │
│ │                                                           | |
| |      [ Check ]          [ Test ]          [ Fmt ]         │ │
│ │  [ Clean ]     [ Docs ]       [ Clippy ]     [ Update ]   │ │
│ │                                                           │ │
│ │  Custom: [ __________________________________ ] [ Go ]    │ │
│ │                                                           │ │
│ │  Output                                               ▼   │ │
│ │  ┌─────────────────────────────────────────────────────┐  │ │
│ │  │ streaming cargo/stdout text                          │ │ │
│ │  └─────────────────────────────────────────────────────┘  │ │
│ /───────────────────────────────────────────────────────────\ │
└───────────────────────────────────────────────────────────────┘
```
the rectangle that has the "Debug" and "Release" labels in it on either side with a divider in the middle of them will be transparent and have a black fill rectangle inside that will slide back and forth between the two to the one that is selected and make the selected label orange. the unselected label will b


## Interaction mapping

- **Primary actions:**
  - `Build` runs `cargo build` with the shared argument fields.
  - `Run` launches `cargo run` (program arguments are appended after `--`).

- **Secondary actions:** the darker button grid triggers `check`, `test`, `fmt`, `clean`, `doc`, and `clippy` directly using the same shared argument fields.
- **Custom command:** the text box accepts a full `cargo <subcommand> ...` string (e.g. `fmt -- --check`) and the **Go** button executes it. Program arguments are forwarded, though the default custom command ignores them.

## Future enhancements

- Wire the gear button into an actual settings panel (default profile selection, optional cargo profiles like `dev`/`bench`).
- Persist recent custom commands and argument presets.
- Add per-command badges/tooltips that remind the user how program arguments are handled (only `run`/`test` currently insert `--`).
- Consider a compact layout breakpoint for smaller displays that stacks secondary buttons into a carousel.
