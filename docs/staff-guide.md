# Staff guide: signing in and changing the website

For restaurant staff. Plain steps, no technical knowledge needed. Facts come from the admin pages in
`src/app/[lang]/(staff)/admin/` and `supabase/README.md` (2026-11-14).

> Not live yet. Staff sign-in works once the website is connected to its database on the real host (release
> checklist, B12). On a local copy the sign-in page shows but cannot sign anyone in.

## 1. Getting an account (once per person)

Staff accounts are by invitation only; nobody can sign up on the website.

1. The owner (or whoever runs the Supabase account) invites the person by email: Supabase dashboard,
   **Authentication → Users → Invite**.
2. The owner then gives that person access with one line in the Supabase SQL editor (steps in
   `supabase/README.md`, "Setup at provisioning"). Role is `staff`, or `owner` for the owner.
3. The person opens the invitation email, clicks the link and chooses a password (at least 12 characters, typed twice).

Forgot your password? There is no "forgot password" button yet. Ask the owner to send a reset email from the
Supabase dashboard; the link opens the same "choose a password" page.

To remove someone: the owner deletes their access line (README, "Revoke"). They are locked out on their next click.

## 2. Signing in

1. Go to the website's address followed by `/admin` (for example `<website address>/admin`). Once a separate staff
   address such as `admin.<website address>` is set up, use that one instead.
2. Enter your **Email** and **Password**, then **Sign in**.
3. Too many wrong tries from one network (10 in 15 minutes) pause sign-in for a while. Wait and try again.
4. When done, click **Sign out**, especially on a shared computer.

The staff pages are English only and are hidden from search engines.

## 3. What you can change, and how

Open **Website content** from the dashboard. Every change is a **draft** first; guests see nothing until you publish.

**The routine:** choose a section under **Edit** → change it → save → **Preview draft** → **Publish draft**. The
website shows the new version from the next page load.

| To change | Section to open | What you can do |
| --- | --- | --- |
| Opening hours, lunch special, policies | **Hours, lunch special and dining policies** | Tick the days (consecutive, shown as "Wed to Sun"), set opening and closing times, the lunch price (whole dollars) and the dishes for each course (one per line), and the policy lines under the menu. |
| Menu dishes and prices | **Menu: (section name)** | Edit a dish's name, description and price in dollars (for example `18` or `2.50`). With no price, fill in **Price note** ("each", "Market price"). Add a dish in an empty row; tick **Remove this dish** to remove one. |
| Banquet packages | **Banquet: (package name)** | Name, price per person, summary, courses and dishes. |
| Gallery photos | **Gallery: (section name)** | Replace a photo, add one in an empty row, or tick **Remove this photo from the gallery**. Fill in **Description for screen readers** (what the photo shows), an optional **Caption**, the **Date taken or posted**, and a **Link to the original post** if it came from Instagram. |

**Photos:** JPEG, PNG or WebP, at most 3.5 MB, at least 400 pixels on the short side. Aim for 1080 pixels or more so
it looks sharp. The website resizes and crops it to the slot's shape for you. Use real photos of the restaurant only.
iPhone photos work when uploaded from the phone. Removed photos can take about 2 hours to disappear everywhere.

**Made a mistake?** Under **Versions** every saved version is listed. **Preview** looks at it, **Publish** puts it back
on the website at once, and **Copy to draft** starts editing from it.

## 4. What staff cannot change (ask the developer)

- The phone number, the OpenTable "Book now" link and the lunch rule (three courses, beverages not included). These
  are fixed on purpose.
- The Russian translations: dishes you add show in English on the Russian pages until the developer adds the Russian
  name.
- Page text such as the home page, About and Private Events wording, and adding or reordering whole sections.

## 5. Other staff pages

- **Counts** (on the dashboard): Book now and Call taps for the last 6 months,
  English and Russian.
- **Security** (owner only): alerts about suspicious activity, blocking a network. See
  `docs/incident-response.md`.
