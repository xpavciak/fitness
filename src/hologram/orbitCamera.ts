import { Vector3, type Camera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const UP = new Vector3(0, 1, 0);
const offset = new Vector3();

/**
 * Orbit controls tuned for a page that must stay scrollable:
 * - no wheel zoom (the wheel scrolls the page),
 * - only a narrow vertical tilt range (horizontal drag rotates; on touch the
 *   canvas uses `touch-action: pan-y`, so vertical swipes scroll the page),
 * - programmatic rotation for the keyboard-accessible ←/→ buttons.
 */
export class OrbitCamera {
  private readonly controls: OrbitControls;

  constructor(
    private readonly camera: Camera,
    domElement: HTMLElement,
    private readonly onChange: () => void,
  ) {
    const c = new OrbitControls(camera, domElement);
    c.target.set(0, 0.8, 0);
    c.enablePan = false;
    c.enableZoom = false;
    c.enableDamping = true;
    c.minPolarAngle = 1.1;
    c.maxPolarAngle = 1.48;
    c.update();
    c.addEventListener('change', onChange);
    this.controls = c;
  }

  /** Rotates the camera around the figure; positive = counter-clockwise from above. */
  rotateBy(degrees: number): void {
    const target = this.controls.target;
    offset
      .copy(this.camera.position)
      .sub(target)
      .applyAxisAngle(UP, (degrees * Math.PI) / 180);
    this.camera.position.copy(target).add(offset);
    this.controls.update();
    this.onChange();
  }

  /** Call every rendered frame so damping can settle. */
  update(): void {
    this.controls.update();
  }

  dispose(): void {
    this.controls.removeEventListener('change', this.onChange);
    this.controls.dispose();
  }
}
