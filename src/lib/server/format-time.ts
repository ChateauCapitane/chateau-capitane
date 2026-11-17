const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
/** Restaurant-local (Brooklyn) time for staff screens. */
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
