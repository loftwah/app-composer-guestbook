// Calendar days, not instants: no timezone conversion, locale parsing or rollover.
// The same bounded Gregorian rule is compiled into native EmDash string validation.
export const calendarDatePattern =
  "^(?!0000)(?:[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)$";
const calendarDate = new RegExp(calendarDatePattern);
export function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === "string" && value.length === 10 && calendarDate.test(value)
  );
}
export function calendarDateLabel(value: unknown): string | null {
  return isCalendarDate(value)
    ? new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T12:00:00.000Z"))
    : null;
}
