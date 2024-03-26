import { serverUrl } from "../routes/routes";
import { dateFromString, getNowDateTime, dateTimesAreSameDay, TIMEZONE, DEFAULT_DATE_TIME_FORMAT, dateFormatter, dateWithoutTime, dateFromFormat, getDateCustom, dateWithTime, DEFAULT_DATE_FORMAT_BR, setPreviousDateTime, DEFAULT_DATE_TIME_FORMAT_BR, DEFAULT_DATE_MONTH_TIME_FORMAT_BR } from "../util/dateFormatter";
import { getTextBetween } from "../util/getTextBetween";
import removeAccents from "../util/removeAccents";
import removeLetters from "../util/removeLetters";
import browserScreenshot from "./browser-screenshot";
import { procedure } from "./procedure";

const { google } = require("googleapis");
const { DateTime } = require("luxon");
const puppeteer = require('puppeteer');
const os = require('os');
const md5 = require('md5');
const fs = require('fs');

class GoogleCalendarAPI {
  GOOGLE_PRIVATE_KEY = "/var/www/html/teste/key.json";
  GOOGLE_CLIENT_EMAIL = "tiego.torelli@gmail.com";
  GOOGLE_CALENDAR_ID = this.GOOGLE_CLIENT_EMAIL;
  GOOGLE_PROJECT_NUMBER = "double-archive-413503";
  SCOPES = ["https://www.googleapis.com/auth/calendar"];
  MAX_DAYS = 100;
  PIPE = ' | ';
  EMOJI = '😄';
  EMOJI_BAD = '🙁';

  STATUS = {
    UNAVAILABLE: 0,
    AVAILABLE: 1,
    NOT_ENOUGH: 2,
    SCHEDULED: 3
  };

  jwtClient = new google.auth.JWT(
    this.GOOGLE_CLIENT_EMAIL,
    null,
    this.GOOGLE_PRIVATE_KEY,
    this.SCOPES,
  );

  calendar = google.calendar({
    version: "v3",
    project: this.GOOGLE_PROJECT_NUMBER,
    auth: this.jwtClient,
  });

  auth = new google.auth.GoogleAuth({
    keyFile: "./gcp-key.json",
    scopes: this.SCOPES,
  });

  clientString(clientId) {
    return `#${clientId}`;
  }

  async deleteEvent(date, clientId) {
    let events = await this.listEventsByClient(clientId, date, 1);
    if (!events.length || !dateTimesAreSameDay(date, events[0].start.dateTime) /*!dateFromString(events[0].start.dateTime).equals(dateFromString(date))*/) {
      throw new Error('Agendamento não localizado em ' + dateFormatter(date, DEFAULT_DATE_FORMAT_BR));
    }
    await this.calendar.events.delete({
      auth: await this.auth.getClient(),
      calendarId: this.GOOGLE_CALENDAR_ID,
      eventId: events[0].id,
    });
    return events[0];
  }

  async isSlotAvailable(start, end) {
    const diff = end.diff(start, ["minutes"]);
    let slots = await this.listSlotsByDate(diff.minutes, start);
    if (!slots.length || slots[0].status != 1) {
      return false;
    }
    const eventStart = dateFromString(slots[0].start);
    return start.equals(eventStart);
  }

  async addEvent(start, end, summary, clientId, description = '', emails = []) {
    start = dateFromString(start);
    end = dateFromString(end);
    if (!await this.isSlotAvailable(start, end)) {
      throw new Error(`Desculpe, este horário não está disponível (${dateFormatter(start)}) ${this.EMOJI_BAD} por favor, escolha outro...`);
    }

    description += (description ? this.PIPE : '') + this.clientString(clientId);
    const attendees = emails.map(email => ({ email }));

    const calendarEvent = {
      summary,
      description,
      start: {
        dateTime: start.toISO(),
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: end.toISO(),
        timeZone: TIMEZONE,
      },
      attendees,
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 10 },
        ],
      },
    };

    const response = await this.calendar.events.insert({
      auth: await this.auth.getClient(),
      calendarId: this.GOOGLE_CALENDAR_ID,
      resource: calendarEvent,
    });
    return response.data;
  }

  async listEventsByClient(clientId, start = null, days = null) {
    return (await this.listEvents(start, (days ? days : this.MAX_DAYS))).filter(event => event.description.indexOf(this.clientString(clientId)) !== -1);
  }

  async listEventsByClientFormat(clientId) {
    let events = await this.listEventsByClient(clientId);
    let newEvents = [];
    events.forEach(event => {
      let desc = event.description.indexOf(this.PIPE) === -1 ? [''] : event.description.split(this.PIPE);
      newEvents.push({
        summary: String(event.summary).split(' - ')[0],
        description: desc[0],
        start: dateFormatter(event.start.dateTime, DEFAULT_DATE_TIME_FORMAT),
        end: dateFormatter(event.end.dateTime, DEFAULT_DATE_TIME_FORMAT),
        status: this.STATUS.SCHEDULED,
        label: String(event.summary).split(' - ')[0]
      });
    });
    return newEvents;
  }

  async listEvents(start = null, numberOfDays = 0) {
    start = (start ? dateFromString(start) : getNowDateTime());
    const endDateTime = start.plus({ days: numberOfDays }).set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

    const result = await this.calendar.events.list({
      auth: await this.auth.getClient(),
      calendarId: this.GOOGLE_CALENDAR_ID,
      timeMin: start.toISO(),
      timeMax: endDateTime.toISO(),
      maxResults: this.MAX_DAYS,
      singleEvents: true,
      orderBy: "startTime",
    });
    return result.data.items || [];
  }

  async addProcedure(name, date, clientId, clientName = '') {
    //date = dateFromString(date).set({ seconds: 0, millisecond: 0 });
    let info = procedure.getProcedure(name);
    return this.addEvent(date, date.plus({ minutes: info.value }), info.key + (clientName ? ` - ${clientName}` : ''), clientId);
  }

  getWorkingHoursByWeekDay(weekDay = 1) {
    let workingHoursStart, workingHoursEnd;
    switch (weekDay) {
      case 7: // Sunday
        break;
      case 6: // Saturday
        workingHoursStart = 8;
        workingHoursEnd = 15;
        break;
      default: // Weekdays (Monday to Friday)
        workingHoursStart = 8;
        workingHoursEnd = 20;
        break;
    }
    return { workingHoursStart, workingHoursEnd };
  }

  getWorkingHours(date) {
    return this.getWorkingHoursByWeekDay(date.weekday);
  }

  async listSlotsByDate(durationMinutes, date, events = []) {
    const slots: any[] = [];

    let { workingHoursStart, workingHoursEnd } = this.getWorkingHours(date);
    if (!workingHoursStart || !workingHoursEnd) {
      let { workingHoursStart, workingHoursEnd } = this.getWorkingHoursByWeekDay();
      slots.push({
        start: dateFormatter(getDateCustom(date, workingHoursStart), DEFAULT_DATE_TIME_FORMAT),
        end: dateFormatter(getDateCustom(date, workingHoursEnd), DEFAULT_DATE_TIME_FORMAT),
        status: this.STATUS.UNAVAILABLE,
      });
      return slots;
    }

    if (!events.length) {
      events = await this.listEvents(date);
    }

    let currentEndTime = getDateCustom(date, workingHoursStart);
    if (currentEndTime < date) {
      currentEndTime = date.set({ second: 0, millisecond: 0 });
    }

    let now = getNowDateTime();
    now = getDateCustom(now, now.hour, now.minute);

    if (now > currentEndTime) {
      slots.push({
        start: dateFormatter(getDateCustom(date, workingHoursStart), DEFAULT_DATE_TIME_FORMAT),
        end: dateFormatter(now, DEFAULT_DATE_TIME_FORMAT),
        status: this.STATUS.UNAVAILABLE,
      });
      date = currentEndTime;
    }

    for (const event of events) {
      const startTime = DateTime.fromISO(event.start.dateTime);
      if (!date.hasSame(startTime, 'day')) {
        continue;
      }
      const endTime = DateTime.fromISO(event.end.dateTime);
      if (endTime < now) {
        currentEndTime = now;
        continue;
      }

      // Calculate the duration of the gap between events in minutes
      const gapDuration = (startTime - currentEndTime) / (60 * 1000);

      // Check if the gap duration is greater than or equal to the specified duration
      if (gapDuration >= durationMinutes) {
        slots.push({
          start: dateFormatter(currentEndTime, DEFAULT_DATE_TIME_FORMAT),
          end: dateFormatter(startTime, DEFAULT_DATE_TIME_FORMAT),
          status: this.STATUS.AVAILABLE,
        });
      } else {
        slots.push({
          start: dateFormatter(currentEndTime, DEFAULT_DATE_TIME_FORMAT),
          end: dateFormatter(startTime, DEFAULT_DATE_TIME_FORMAT),
          status: this.STATUS.NOT_ENOUGH,
        });
      }
      slots.push({
        start: dateFormatter(startTime, DEFAULT_DATE_TIME_FORMAT),
        end: dateFormatter(endTime, DEFAULT_DATE_TIME_FORMAT),
        status: this.STATUS.UNAVAILABLE,
      });

      // Update current end time to the end of the current event
      currentEndTime = endTime;
    }

    // Check if there is a gap after the last event within the working hours
    if (currentEndTime.hour * 60 + currentEndTime.minute < workingHoursEnd * 60) {
      const endOfDay = getDateCustom(date, workingHoursEnd);

      // Check if there is a gap after the last event
      const lastGapDuration = (endOfDay - currentEndTime) / (60 * 1000);
      if (lastGapDuration >= durationMinutes) {
        slots.push({
          start: dateFormatter(currentEndTime, DEFAULT_DATE_TIME_FORMAT),
          end: dateFormatter(endOfDay, DEFAULT_DATE_TIME_FORMAT),
          status: this.STATUS.AVAILABLE,
        });
      }

      let endOfDayDefault = getDateCustom(date, this.getWorkingHoursByWeekDay().workingHoursEnd);
      if (!endOfDay.equals(endOfDayDefault)) {
        slots.push({
          start: dateFormatter(endOfDay, DEFAULT_DATE_TIME_FORMAT),
          end: dateFormatter(endOfDayDefault, DEFAULT_DATE_TIME_FORMAT),
          status: this.STATUS.UNAVAILABLE,
        });
      }
    }
    return slots;
  }

  async listSlots(durationMinutes = 1, date = '', numberOfDays = 1) {
    date = (date ? dateFromString(date) : getNowDateTime());
    const events = await this.listEvents(date, numberOfDays);

    let slots = [];
    for (let day = 0; day < numberOfDays; day++) {
      if (day) {
        date = dateWithoutTime(date);
      }
      slots = [...slots, ... await this.listSlotsByDate(durationMinutes, date.plus({ days: day }), events)];
    }
    return slots;
  }

  getUrl(slots, date, dayCount = null) {
    let { workingHoursStart, workingHoursEnd } = this.getWorkingHoursByWeekDay();
    let params = `slots=${JSON.stringify(slots)}&initialDate=${date.toISO()}&minTime=${workingHoursStart}&maxTime=${workingHoursEnd}&dayCount=${dayCount}`;
    return serverUrl + '/calendar?' + params;
  }

  async saveCalendar(slots, date = null, numberOfDays = null) {
    date = (date ? dateFromString(date) : getNowDateTime());

    let fileName = md5(JSON.stringify(slots)) + '.png';
    let dir = os.tmpdir() + '/whatsapp-images/';
    let path = dir + fileName;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    let url = this.getUrl(slots, date, numberOfDays || 7);
    return browserScreenshot(url, path);
  }

  async listSlotsByProcedure(name, date = '', numberOfDays = 7) {
    date = dateFromFormat(date);
    return this.listSlots(procedure.getProcedure(name).value, date, numberOfDays);
  }

  getDateMessage() {
    return `Qual é o horário no qual você gostaria de agendar? ${this.EMOJI}`;
  }

  getProcedureInfo(message, nameRequired = true, timeRequired = true) {
    let now = getNowDateTime();
    //console.log(message);
    //console.log(procedure.getMessageString());
    let [name, date, time] = getTextBetween(message, procedure.getMessageString(), '.').trim().split(' - ');
    /*console.log('name: ' + name);
    console.log('date: ' + date);
    console.log('time: ' + time);*/
    date = String(date ? date.split(' ')[0] : '');
    time = String(time ? time.split(' ')[0] : '');
    console.log('name: ' + name);
    console.log('date: ' + date);
    console.log('time: ' + time);
    if (!name && nameRequired) {
      throw new Error(`Qual é o nome do procedimento? ${this.EMOJI}`);
    }
    let length = date.split('/').length;
    //console.log(length);
    if (!length) {
      throw new Error(`Qual é o dia? ${this.EMOJI}`);
    }
    if (length == 1) {
      throw new Error(`Qual é o mês? ${this.EMOJI}`);
    }
    if (length == 2) {
      date += '/' + now.year;
    }
    if (!time && timeRequired) {
      throw new Error(this.getDateMessage());
    }
    //console.log(date);
    date = dateFromFormat(date).set({ seconds: 0, millisecond: 0 });
    //console.log(date);
    if (time) {
      let times = time.split(':');
      date = dateWithTime(date, times[0], times[1]);
    }
    //console.log(name);
    //console.log(date);
    let dateMsg = `Qual é a data desejada? ${this.EMOJI}`;
    if (!date.isValid) {
      throw new Error(dateMsg);
    }
    if (date < dateWithoutTime(now)) {
      throw new Error(`Por favor informe uma data no futuro! ${dateMsg}`);
    }
    if (date && !date.isValid) {
      throw new Error(this.getDateMessage());
    }
    return { name, date };
  }

  parseDateTime(date, time = '') {
    let now = getNowDateTime();
    let dates = String(date).trim().split('/');
    dates = dates.map(removeLetters);
    let length = dates.length;
    if (length <= 1 || isNaN(parseFloat(dates[0])) || isNaN(parseFloat(dates[1])) || (length == 3 && isNaN(parseFloat(dates[3])))) {
      throw new Error(`Por favor informe uma data válida no formato 25/12`);
    }
    if (length == 2) {
      dates.push(now.year);
    }
    date = dateFromFormat(dates.join('/')).set({ seconds: 0, millisecond: 0 });
    if (time) {
      let times = String(time).split(':');
      times = times.map(removeLetters).map((item) => parseFloat(item));
      if (times.length < 1 || isNaN(times[0]) || isNaN(times[1]) || times[0] < 0 || times[0] > 24 || times[1] < 0 || times[1] > 60) {
        throw new Error(`Por favor informe uma hora válida no formato 16:30`);
      }
      date = dateWithTime(date, times[0], times[1]);
    }
    if (!date.isValid) {
      throw new Error(`Por favor informe uma data válida no formato 25/12`);
    }
    if (date < dateWithoutTime(now)) {
      throw new Error(`Por favor informe uma data no futuro`);
    }
    return date;
  }

  getCalendarNoScheduledMessage() {
    return `Você não possui nenhum horário agendado ${this.EMOJI}`;
  }

  getDisplayCalendarScheduledMessage() {
    return `Segue agenda com seus horários agendados nos próximos dias ${this.EMOJI}`;
  }

  getDisplayCalendarMessage() {
    return `Segue agenda com os horários disponíveis na data solicitada e também no dia anterior e seguinte ${this.EMOJI}`;
  }

  getAddEventSuccessMessage(name, date) {
    return `Procedimento agendado: ${name} - ${dateFormatter(date)}`;
  }

  getDeleteEventSuccessMessage(name, date) {
    return `Agendamento excluído: ${name} - ${dateFormatter(date)}`;
  }

  async deleteEventByMessage(message, clientId) {
    //let { date } = this.getProcedureInfo(message, false, false);
    let dateTime = googleCalendar.parseDateTime(message.date, message.time);
    let event = await this.deleteEvent(dateTime, clientId);
    return this.getDeleteEventSuccessMessage(event.summary, event.start.dateTime);
  }

  async addEventByMessage(message, clientId, clientName) {
    //let { name, date } = this.getProcedureInfo(message, true, true);
    let dateTime = googleCalendar.parseDateTime(message.date, message.time);
    await this.addProcedure(message.name, dateTime, clientId, clientName);
    return this.getAddEventSuccessMessage(message.name, dateTime);
  }

  async getProcedureCalendarByMessage(message, numberOfDays = 3) {
    //let { name, date } = this.getProcedureInfo(message, true, false);
    let dateTime = setPreviousDateTime(googleCalendar.parseDateTime(message.date, message.time));
    let slots = await googleCalendar.listSlotsByProcedure(message.name, dateTime, numberOfDays);
    return googleCalendar.saveCalendar(slots, dateTime, numberOfDays);
  }

  async getSchedules(clientId) {
    let events = await this.listEventsByClientFormat(clientId);
    let str = '';
    let days = 1;
    let firstDay = (events.length ? dateWithoutTime(dateFromString(events[0].start)) : null);
    events.forEach((event) => {
      str += (str ? '\n' : '') + `${event.summary} - ${dateFormatter(event.start, DEFAULT_DATE_MONTH_TIME_FORMAT_BR)}`;
      const diff = dateWithoutTime(dateFromString(event.start)).diff(firstDay, ["days"]);
      if (diff.days && diff.days <= 7) {
        days = diff.days + 1;
      }
    });
    let file = (events.length ? await this.saveCalendar(events, events[0].start, days) : null);
    let label = (events.length ? this.getDisplayCalendarScheduledMessage() + '\n\n' + str : this.getCalendarNoScheduledMessage());
    return { events, file, label };
  }

  isDeleteScheduleMessage(message) {
    return message.indexOf(procedure.getMessageDeleteScheduleString()) != -1;
  }

  isScheduleMessage(message) {
    return message.indexOf(procedure.getMessageScheduleString()) != -1;
  }

  isCheckSlotsMessage(message) {
    return message.indexOf(procedure.getMessageCheckSlotsString()) != -1;
  }

  isCheckScheduleMessage(message) {
    return message.indexOf(procedure.getMessageCheckScheduleString()) != -1;
  }
}

export const googleCalendar = new GoogleCalendarAPI();