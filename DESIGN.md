---
name: Here / there
description: Guestbook collection and postcard presentation
colors:
  dark-bg: "#17181b"
  dark-fg: "#f2f3f5"
  dark-muted: "#afb3bb"
  dark-surface: "#23252a"
  dark-field: "#1d1f23"
  dark-border: "#444952"
  dark-control: "#797f8a"
  dark-accent: "#ff9b55"
  light-bg: "#faf9f7"
  light-fg: "#22252b"
  light-muted: "#5c616a"
  light-surface: "#efeeea"
  light-field: "#fff"
  light-border: "#d3d1cc"
  light-control: "#747983"
  light-accent: "#a63d08"
  postcard-paper: "#f4f0e7"
  postcard-ink: "#20241e"
  postcard-rule: "#758174"
typography:
  display: {fontFamily: "Space, system-ui", fontSize: "clamp(2.5rem, 4.6vw, 4.4rem)", fontWeight: 600, lineHeight: 1.04, letterSpacing: "-.025em"}
  headline: {fontFamily: "Space, system-ui", lineHeight: 1.1, letterSpacing: "-.025em"}
  body: {fontFamily: "system-ui, sans-serif", fontSize: "16px", lineHeight: 1.55}
  label: {fontFamily: "Space, system-ui", fontSize: "13px", fontWeight: 600, lineHeight: 1.5, letterSpacing: ".06em"}
rounded: {field: "6px", media: "8px", dialog: "12px", badge: "5px"}
spacing: {control: "12px", page: "24px 32px", page-phone: "18px 20px", workbench-gap: "40px"}
components:
  button-primary: {backgroundColor: "{colors.dark-accent}", textColor: "{colors.dark-bg}", rounded: "{rounded.media}", padding: "12px 20px"}
  button-secondary: {backgroundColor: "{colors.dark-surface}", textColor: "{colors.dark-fg}", rounded: "{rounded.media}", padding: "12px 20px"}
  input: {backgroundColor: "{colors.dark-field}", textColor: "{colors.dark-fg}", rounded: "{rounded.field}", padding: "12px", typography: "{typography.body}"}
  badge: {backgroundColor: "{colors.dark-surface}", textColor: "{colors.dark-muted}", rounded: "{rounded.badge}", padding: "5px 10px"}
  postcard-preview: {backgroundColor: "{colors.postcard-paper}", textColor: "{colors.postcard-ink}", rounded: "{rounded.media}"}
---

# Design System: Here / there

## Overview

**Creative North Star: "The guestbook letterbox"**

Keep the built editorial collection: Space headings, charcoal or warm-light surfaces, orange actions and one cut-paper screenprint hero. Guest postcards extend that world with paper, ink and a visible preview. Here / there remains the guestbook identity; Linkarooie names the related collection destination. Owner titles, introductions, layouts and theme settings remain authoritative.

**Key Characteristics:**
- Original self-hosted cut-paper illustration, explicitly separate from submitted contributions.
- Flat collection sections, native controls and readable contribution text.
- A paper postcard preview within the existing interface, in either theme.
- Honest states: an empty collection says so plainly, hides search, and offers the action that actually exists.

Source truth is `src/common.ts`, `src/worker.ts`, `public/brand/navigation.css` and `public/brand/guest-postcard.js`. Artwork provenance is `public/brand/herethere-art-v3.PROVENANCE.txt`; keep its master, 480/960px WebP sources, reserved dimensions, social derivatives, the 96px navigation crop and the adjacent licence/font notices. It also records the assets this release removed. No new artwork or visual identity is introduced here.

Retained local fictional browser captures in `.private/postcard-captures/` cover `final-form-{390,1728}-{dark,light}.png` and `detail-{390,1728}-{dark,light}.png`. They document form/preview layout, focus appearance and long-caption wrapping; screenshots alone do not prove submission, approval or revocation interactions. Production release/pin promotion, physical-device and screen-reader acceptance remain separate gates.

## Colors

### Primary
Orange is the action and focus accent: the dark accent on charcoal, the light accent on warm light. Light-theme primary buttons use white text. The postcard heading uses the light accent in both themes.

### Neutral
Theme foreground, muted, surface, field, border and control roles map directly to the existing CSS variables. Body and fields follow the saved reader theme; mounted mode uses Composer's theme key. The postcard always keeps its paper, ink and ruled-border colors. Sidecar tonal ramps are documentation swatches, not additional shipped theme tokens.

## Typography

Self-hosted Space is the heading/display face with system fallback; system sans-serif supplies body copy and controls. Hero display type is responsive; ordinary page headings use `clamp(2.5rem, 4.5vw, 3.5rem)`. Collection headings are (24px), gallery titles (20px), and muted captions (12–14px). Form inputs inherit the body size (16px).

The canvas uses system type: heading (600, 28px), message (40px) with (62px) line steps, and alias (28px). Keep the full caption and alias as real page text outside the raster. Do not rely on canvas text as the accessible copy.

## Layout

The page is centred within (1248px), with the page padding tokens above. The hero has two columns and stacks below (820px). Gallery is three columns, editorial two, and both become one column below (700px). Header navigation wraps rather than clipping; the app launcher remains a native dialog alongside ordinary links.

The postcard workbench has equal form/preview columns with its documented gap. Below (820px) it becomes one column, the preview loses sticky positioning, gap becomes (28px), and fieldset padding becomes (16px). Desktop preview sticks (24px) from the top. Canvas scales proportionally at (4:3); detail media uses `object-fit: contain`.

**The Content Wrap Rule.** User headings, captions, aliases, paragraphs and the owner brand can wrap anywhere. Preserve `min-width: 0` on constrained content. The detail header displays the owner brand, while the caption stays in the page heading and metadata.

## Elevation & Depth

Collection and form surfaces are flat, with thin rules and tonal contrast instead of shadows. The postcard has an inset ruled border. The app dialog uses a dark translucent backdrop to separate it from the page; this does not introduce a shadow vocabulary.

## Shapes

Keep softly rounded fields, media and buttons using the extracted radii. Fieldsets retain their thin outline and native legend. Consent uses a native checkbox (20px), a wrapping label and a visible keyboard focus ring (3px), offset (4px). Functional launcher geometry remains the existing licensed vector; illustration remains the existing raster artwork.

## Components

- **Buttons:** primary accent and secondary surface variants retain native semantics, a (48px) primary minimum height and brightness hover. Launcher/theme controls retain their (44px) targets. Pending postcard sends disable the fieldset and show explicit sending text; errors retain entries, and success prevents an unchanged repeat submission.
- **Postcard form:** native labelled guest-code, message and optional alias fields, associated hints, required consent, and a polite status region. Message limit is (160 characters), alias (60). Without JavaScript, the page explains that no postcard is prepared or submitted. Timeout copy admits that review may already be pending.
- **Paper preview:** the implementation draws a (1200 × 900) canvas with an inset (48px) border and text inset (92px). Caption wraps by Unicode code point within (1016px), including unbroken text. The alias remains complete in accessible metadata even when its drawn width is constrained. The canvas is hidden from assistive technology; labels and real caption/alias text carry meaning.
- **Collection/detail:** approved contributions appear as linked media and real caption/alias text. Synthetic demo art keeps its explicit label. Detail pages retain the owner brand and a back link; long captions wrap without forcing horizontal overflow.
- **Navigation:** use ordinary app/owner links, saved theme control and the existing searchable Ctrl/Cmd+K dialog. Preserve Guestbook versus Linkarooie destination labels and current-page indication without changing route IDs.
- **Privacy states:** default guest access is closed. The public `hunter2` puzzle code permits only a new pending postcard; it is not owner authentication. Approval makes a contribution public. Hide/delete revokes controlled public/provider/media access on the next request; downloaded copies cannot be recalled. UI wording must retain these distinctions.

## Do's and Don'ts

- **Do** preserve both themes, original artwork/provenance and owner configuration.
- **Do** keep caption/alias available outside the postcard image and wrap unbroken input.
- **Do** distinguish pending review, public approval, closed/paused submissions and revocation in visible copy.
- **Don't** turn the guest code into an owner sign-in, imply automatic publication or expose unpublished contributions.
- **Don't** rebrand this guestbook, replace existing assets, or claim production/device/screen-reader acceptance from local captures.
