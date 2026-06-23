// calendar-enhanced.js
// Enhanced calendar functionality with bug fixes and improvements

/**
 * Enhanced Calendar Manager
 * Handles calendar events with improved UI, validation, and notifications
 */

export class CalendarManager {
  constructor(fm, db) {
    this.fm = fm;
    this.db = db;
    this.events = [];
    this.selectedDate = new Date();
    this.notificationCallback = null;
  }

  /**
   * Initialize calendar
   */
  async initialize() {
    this.loadFromLocalStorage();
    this.cleanExpiredEvents();
    console.log("✅ Calendar Manager initialized");
  }

  /**
   * Load events from localStorage
   */
  loadFromLocalStorage() {
    try {
      const local = localStorage.getItem("familyPrimeData");
      if (local) {
        const parsed = JSON.parse(local);
        this.events = parsed.calendarEvents || [];
      }
    } catch (e) {
      console.warn("Error loading calendar from localStorage:", e);
      this.events = [];
    }
  }

  /**
   * Add a calendar event with validation
   */
  async addEvent(dateString, eventName, description = "", eventTime = null) {
    // Validation
    if (!dateString || !dateString.trim()) {
      throw new Error("La date est requise");
    }

    if (!eventName || !eventName.trim()) {
      throw new Error("Le nom de l'événement est requis");
    }

    const eventDate = new Date(dateString);
    if (isNaN(eventDate.getTime())) {
      throw new Error("La date est invalide");
    }

    // Validate time format if provided (HH:mm)
    if (eventTime && !/^\d{2}:\d{2}$/.test(eventTime)) {
      throw new Error("L'heure doit être au format HH:mm");
    }

    // Create event object
    const event = {
      id: `event_${Date.now()}_${Math.random()}`,
      date: dateString,
      time: eventTime || null, // Format: "14:30"
      name: eventName.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
      notified: false,
      completed: false,
    };

    this.events.push(event);
    await this.saveToFirestore();

    console.log("✅ Event added:", event);
    return event;
  }

  /**
   * Update an existing event
   */
  async updateEvent(eventId, updates) {
    const eventIndex = this.events.findIndex((e) => e.id === eventId);
    if (eventIndex === -1) {
      throw new Error("Événement non trouvé");
    }

    this.events[eventIndex] = {
      ...this.events[eventIndex],
      ...updates,
      id: this.events[eventIndex].id, // Keep original ID
      createdAt: this.events[eventIndex].createdAt, // Keep creation date
    };

    await this.saveToFirestore();
    console.log("✅ Event updated:", this.events[eventIndex]);
    return this.events[eventIndex];
  }

  /**
   * Delete an event by ID or index
   */
  async deleteEvent(eventIdOrIndex) {
    let index;

    if (typeof eventIdOrIndex === "number") {
      index = eventIdOrIndex;
    } else {
      index = this.events.findIndex((e) => e.id === eventIdOrIndex);
    }

    if (index === -1 || index >= this.events.length) {
      throw new Error("Événement non trouvé");
    }

    const deleted = this.events.splice(index, 1);
    await this.saveToFirestore();

    console.log("✅ Event deleted:", deleted[0]);
    return deleted[0];
  }

  /**
   * Get events for a specific date
   */
  getEventsByDate(dateString) {
    const targetDate = new Date(dateString).toDateString();
    return this.events.filter((evt) => new Date(evt.date).toDateString() === targetDate);
  }

  /**
   * Get upcoming events (next 30 days)
   */
  getUpcomingEvents(days = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const future = new Date(today);
    future.setDate(future.getDate() + days);

    return this.events
      .filter((evt) => {
        const evtDate = new Date(evt.date);
        return evtDate >= today && evtDate <= future;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  /**
   * Get all events sorted by date
   */
  getEventsSorted() {
    return [...this.events].sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  /**
   * Mark event as notified
   */
  async markNotified(eventId) {
    return this.updateEvent(eventId, { notified: true });
  }

  /**
   * Mark event as completed
   */
  async toggleCompleted(eventId) {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) throw new Error("Événement non trouvé");

    return this.updateEvent(eventId, { completed: !event.completed });
  }

  /**
   * Clean up expired events (older than today)
   */
  cleanExpiredEvents() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const initialCount = this.events.length;
    this.events = this.events.filter((evt) => {
      const eventDate = new Date(evt.date);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate >= today;
    });

    if (this.events.length < initialCount) {
      console.log(`🗑️ Removed ${initialCount - this.events.length} expired events`);
    }
  }

  /**
   * Save to Firebase
   */
  async saveToFirestore() {
    try {
      await this.fm.updateData("lists", "shopping", {
        calendarEvents: this.events,
      });
    } catch (err) {
      console.error("❌ Error saving calendar to Firestore:", err);
      throw err;
    }
  }

  /**
   * Get event by ID
   */
  getEventById(eventId) {
    return this.events.find((e) => e.id === eventId);
  }

  /**
   * Search events by name
   */
  searchEvents(query) {
    const q = query.toLowerCase();
    return this.events.filter((evt) => evt.name.toLowerCase().includes(q) || evt.description.toLowerCase().includes(q));
  }

  /**
   * Export events as JSON
   */
  exportEvents() {
    return JSON.stringify(this.getEventsSorted(), null, 2);
  }

  /**
   * Format date for display (French)
   */
  static formatDate(dateString) {
    const dateObj = new Date(dateString);
    return dateObj.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  /**
   * Format date with day name
   */
  static formatDateWithDay(dateString) {
    const dateObj = new Date(dateString);
    return dateObj.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  /**
   * Get days until event
   */
  static daysUntilEvent(dateString) {
    const eventDate = new Date(dateString);
    const today = new Date();
    const diffTime = eventDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
}

export default CalendarManager;
