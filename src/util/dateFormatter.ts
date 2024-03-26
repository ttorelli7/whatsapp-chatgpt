const { DateTime } = require("luxon");

export const TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_DATE_TIME_FORMAT = 'yyyy-MM-dd HH:mm:ss';
export const DEFAULT_DATE_FORMAT_BR = 'dd/MM/yyyy';
export const DEFAULT_DATE_TIME_FORMAT_BR = 'dd/MM/yyyy HH:mm';
export const DEFAULT_DATE_MONTH_TIME_FORMAT_BR = 'dd/MM HH:mm';

export function dateFromString(date) {
  try {
    if (typeof date === 'DateTime') {
      return date;
    }
    date = String(date).trim().replace(' ', 'T');
    if (!date) {
      throw new Error();
    }
    return DateTime.fromISO(date).setZone(TIMEZONE);
  } catch (err) {
    throw err;
  }
}

export function dateFormatter(date, pattern = DEFAULT_DATE_TIME_FORMAT_BR) {
  if (typeof date === 'string') {
    date = dateFromString(date);
  }
  return date.setZone(TIMEZONE).toFormat(pattern);
}

export function getNowDateTime() {
  return DateTime.utc().setZone(TIMEZONE);
}

export function dateFromObject(obj) {
  return DateTime.fromObject(obj).setZone(TIMEZONE);
}

export function dateFromFormat(date, format = DEFAULT_DATE_FORMAT_BR) {
  if (date instanceof DateTime) {
    return date;
  }
  return DateTime.fromFormat(date, format);
}

export function dateWithTime(date, hour, minute, second = 0) {
  return date.set({
    hour, minute, second, millisecond: 0,
  });
}

export function dateWithoutTime(date) {
  return Object.assign(date).set({
    hour: 0, minute: 0, second: 0, millisecond: 0,
  });
}

export function getDateCustom(date, hour, minute = 0) {
  return dateFromObject({
    year: date.year,
    month: date.month,
    day: date.day,
    hour,
    minute,
    second: 0,
    millisecond: 0
  });
}

export function dateTimesAreSameDay(dateTime1, dateTime2) {
  dateTime1 = dateFromString(dateTime1);
  dateTime2 = dateFromString(dateTime2);
  return dateTime1.year === dateTime2.year && dateTime1.month === dateTime2.month && dateTime1.day === dateTime2.day;
}

export function setPreviousDateTime(date) {
  date = date.minus({ days: 1 });
  if (date < getNowDateTime()) {
    date = date.plus({ days: 1 });
  } else {
    date = dateWithoutTime(date);
  }
  return date;
}