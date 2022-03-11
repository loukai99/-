/* eslint-disable default-case */
import { EventEmitter } from 'events';
import { ipcRenderer } from 'electron';
import {
  WHEEL_SCROLLING_PHASE as scrolling,
  WHEEL_INERTIAL_SCROLLING_PHASE as inertial,
  WHEEL_STOPPED_PHASE as stopped,
} from '../constants';
// eslint-disable-next-line
const Lethargy = require('exports-loader?this.Lethargy!lethargy/lethargy');

class WheelPhaseCalculator extends EventEmitter {
  wheelTimer = 0;

  scrollingPhase = scrolling;

  inertialPhase = inertial;

  stoppedPhase = stopped;

  _lastPhase = this.stoppedPhase;

  _availablePhases = [
    this.scrollingPhase,
    this.inertialPhase,
    this.stoppedPhase,
  ];

  get lastPhase() { return this._lastPhase; }

  set lastPhase(phase) {
    if (phase !== this._lastPhase && this._availablePhases.includes(phase)) {
      this._lastPhase = phase;
      this.emit('phase-change', phase);
    }
  }

  interval = 200;

  constructor(interval) {
    super();
    if (interval) this.interval = interval;
  }

  calculate(event) {
    this.lastPhase = event ? this.scrollingPhase : this.inertialPhase;
  }
}

class LethargyWheel extends WheelPhaseCalculator {
  // https://github.com/d4nyll/lethargy
  // ╔═════════╦═══════════╦═════════════╦═══════════╗
  // ║         ║ stability ║ sensitivity ║ tolerance ║
  // ╠═════════╬═══════════╬═════════════╬═══════════╣
  // ║  range  ║    5-30   ║    0-120    ║  0.05-0.3 ║
  // ╠═════════╬═══════════╬═════════════╬═══════════╣
  // ║ default ║     8     ║     100     ║    0.1    ║
  // ╠═════════╬═══════════╬═════════════╬═══════════╣
  // ║ current ║     8     ║     100     ║    0.1    ║
  // ╚═════════╩═══════════╩═════════════╩═══════════╝
  lethargy = new Lethargy();

  constructor({
    stability,
    sensitivity,
    tolerance,
    interval,
  } = {
    stability: 8,
    sensitivity: 100,
    tolerance: 0.1,
    interval: 200,
  }) {
    super(interval);
    this.lethargy = new Lethargy(
      stability || 8,
      sensitivity || 100,
      tolerance || 0.1,
    );
  }

  calculate(event) {
    const {
      lethargy,
      scrollingPhase, inertialPhase, stoppedPhase,
      wheelTimer,
      interval,
    } = this;
    this.lastPhase = lethargy.check(event) ? scrollingPhase : inertialPhase;
    clearTimeout(wheelTimer);
    this.wheelTimer = setTimeout(() => { this.lastPhase = stoppedPhase; }, interval);
  }
}
// when you update the value here, remember to update the table above
export const lethargyWheel = new LethargyWheel();

class ElectronWheel extends WheelPhaseCalculator {
  _isTrackPad = false;

  _canInertialScroll = false;

  scrollEnd = false;

  get isTrackPad() { return this._isTrackPad; }

  constructor(interval) {
    super(interval);

    ipcRenderer.on('scroll-touch-begin', () => {
      this._isTrackPad = !(this.scrollEnd = this._canInertialScroll = false);
      this.lastPhase = this.scrollingPhase;
    });
    ipcRenderer.on('scroll-touch-end', () => {
      this.scrollEnd = this._canInertialScroll = true;
    });
  }

  calculate(event) {
    if (event) {
      clearTimeout(this.wheelTimer);
      if (this._isTrackPad && this._canInertialScroll) {
        this.lastPhase = this.inertialPhase;
        this.wheelTimer = setTimeout(() => {
          this.lastPhase = this.stoppedPhase;
          this.scrollEnd = true;
          this._isTrackPad = false;
        }, this.interval);
      } else {
        this.lastPhase = this.scrollingPhase;
        this.wheelTimer = setTimeout(() => {
          this.lastPhase = this.stoppedPhase;
        }, this.interval);
      }
    }
  }
}
export const electronWheel = new ElectronWheel();
