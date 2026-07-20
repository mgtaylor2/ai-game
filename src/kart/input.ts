export interface InputState {
  forward: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
}

const KEY_MAP: Record<string, keyof InputState> = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** Tracks WASD/arrow key state. Listens on window so canvas focus never swallows input. */
export class InputController {
  private readonly state: InputState = {
    forward: false,
    brake: false,
    left: false,
    right: false,
  };

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const field = KEY_MAP[event.code];
    if (!field) return;
    event.preventDefault();
    this.state[field] = true;
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    const field = KEY_MAP[event.code];
    if (!field) return;
    event.preventDefault();
    this.state[field] = false;
  };

  getState(): Readonly<InputState> {
    return this.state;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}
