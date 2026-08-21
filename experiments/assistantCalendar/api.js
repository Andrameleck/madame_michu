/*
 * Minimal privileged bridge for Lightning. Thunderbird does not currently
 * expose calendar CRUD through a built-in MailExtension API, so this module
 * deliberately exposes only the three operations needed by the add-on.
 */

const { ExtensionAPI } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
).ExtensionCommon;
const { ExtensionError } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
).ExtensionUtils;
const { cal } = ChromeUtils.importESModule(
  "resource:///modules/calendar/calUtils.sys.mjs"
);
const { CalEvent } = ChromeUtils.importESModule(
  "resource:///modules/CalEvent.sys.mjs"
);

function getCalendar(calendarId) {
  const calendar = cal.manager.getCalendarById(calendarId);
  if (!calendar) {
    throw new ExtensionError(`Calendrier inconnu : ${calendarId}`);
  }
  return calendar;
}

function serializeCalendar(calendar) {
  return {
    id: calendar.id,
    name: calendar.name,
    readOnly: calendar.readOnly,
    enabled: !calendar.getProperty("disabled"),
  };
}

function serializeEvent(item) {
  return {
    id: item.id,
    title: item.title || "",
    startDate: item.startDate?.toJSDate().toISOString() || "",
    endDate: item.endDate?.toJSDate().toISOString() || "",
    location: item.getProperty("LOCATION") || "",
    description: item.getProperty("DESCRIPTION") || "",
    allDay: Boolean(item.startDate?.isDate),
  };
}

this.assistantCalendar = class extends ExtensionAPI {
  getAPI() {
    return {
      assistantCalendar: {
        async listCalendars() {
          return cal.manager.getCalendars().map(serializeCalendar);
        },

        async queryEvents(calendarId, rangeStart, rangeEnd) {
          const calendar = getCalendar(calendarId);
          const filter =
            Ci.calICalendar.ITEM_FILTER_TYPE_EVENT |
            Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES |
            Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
          const items = await calendar.getItemsAsArray(
            filter,
            0,
            cal.createDateTime(rangeStart),
            cal.createDateTime(rangeEnd)
          );
          return items.map(serializeEvent);
        },

        async createEvent(calendarId, eventData) {
          const calendar = getCalendar(calendarId);
          if (calendar.readOnly || calendar.getProperty("disabled")) {
            throw new ExtensionError("Ce calendrier n'est pas modifiable.");
          }

          const item = new CalEvent();
          item.id = cal.getUUID();
          item.title = eventData.title;
          item.startDate = cal.createDateTime(eventData.startDate);
          item.endDate = cal.createDateTime(eventData.endDate);
          item.setProperty("LOCATION", eventData.location || "");
          item.setProperty("DESCRIPTION", eventData.description || "");
          item.calendar = calendar.superCalendar;

          const created = await calendar.adoptItem(item);
          return serializeEvent(created);
        },
      },
    };
  }
};
