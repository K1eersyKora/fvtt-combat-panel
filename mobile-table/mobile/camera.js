// Scale is measured in CSS pixels per world pixel. Resizing the map changes the
// visible extent, while the same position, scale and orientation are retained.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const easeOutCubic = t => 1 - (1 - t) ** 3;
const lerp = (from, to, t) => (1 - t) * from + t * to;

function clampCenter(point, bounds) {
  if (bounds) {
    point.x = clamp(point.x, bounds.x, bounds.x + bounds.w);
    point.y = clamp(point.y, bounds.y, bounds.y + bounds.h);
  }
  return point;
}

function canAnimate(duration) {
  return Number.isFinite(duration) && duration > 0 && typeof globalThis.requestAnimationFrame === 'function'
    && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function timeToEdge(position, velocity, min, extent) {
  if (velocity === 0) return Infinity;
  const edge = velocity > 0 ? min + extent : min;
  return Math.max(0, (edge - position) / velocity);
}

export class MapCamera {
  #animation = null;
  #rect;

  reset(){
    this.cancelAnimation();
    this.scene=null;this.bounds=null;this.#rect=undefined;
  }
  projection(scene,view,rect,bounds){
    const [a,b,c,d,tx,ty,w,h]=view;
    const visible=rect.width>0&&rect.height>0;
    if(visible)this.#rect=rect;
    if(this.scene!==scene&&visible){
      this.cancelAnimation();
      const det=a*d-b*c,u=w/2-tx,v=h/2-ty;
      this.x=(d*u-c*v)/det;this.y=(a*v-b*u)/det;
      this.angle=Math.atan2(b,a);this.zoom=Math.min(rect.width/w,rect.height/h)*Math.hypot(a,b);
      this.scene=scene;this.bounds=null;
    }
    if(bounds)this.bounds=bounds;
    const scale=this.zoom||1,cos=Math.cos(this.angle||0),sin=Math.sin(this.angle||0),cx=this.x||0,cy=this.y||0;
    const A=scale*cos,B=scale*sin,C=-B,D=A,mx=rect.width/2-A*cx-C*cy,my=rect.height/2-B*cx-D*cy;
    return {rect,scale,a:A,b:B,c:C,d:D,tx:mx,ty:my,
      forward:p=>({x:A*p.x+C*p.y+mx,y:B*p.x+D*p.y+my}),
      inverse:(x,y)=>({x:cx+(cos*(x-rect.width/2)+sin*(y-rect.height/2))/scale,
                        y:cy+(-sin*(x-rect.width/2)+cos*(y-rect.height/2))/scale})};
  }
  anchor(world,screen,rect,scale=this.zoom){
    this.cancelAnimation();
    if(!this.scene||rect.width<=0||rect.height<=0)return;
    this.#rect=rect;
    this.zoom=this.#boundedZoom(scale,rect);
    const u=(screen.x-rect.width/2)/this.zoom,v=(screen.y-rect.height/2)/this.zoom,cs=Math.cos(this.angle),sn=Math.sin(this.angle);
    this.x=world.x-cs*u-sn*v;this.y=world.y+sn*u-cs*v;
    clampCenter(this,this.bounds);
  }

  #boundedZoom(scale, rect) {
    const bounds = this.bounds;
    const fit = bounds && rect?.width > 0 && rect.height > 0 ? Math.min(rect.width / bounds.w, rect.height / bounds.h) : this.zoom;
    return clamp(scale, Math.max(.003, Math.min(fit * .45, .35)), Math.max(6, fit * 6));
  }

  cancelAnimation() {
    if (!this.#animation) return;
    globalThis.cancelAnimationFrame?.(this.#animation.frame);
    this.#animation = null;
  }

  isAnimating() {
    return this.#animation !== null;
  }

  #runAnimation(duration, advance, onFrame, onDone) {
    const animation = this.#animation = {frame: null};
    let start = globalThis.document?.timeline?.currentTime;
    const frame = now => {
      if (this.#animation !== animation) return;
      start ??= now;
      const t = clamp((now - start) / duration, 0, 1);
      const finished = advance(t) || t === 1;
      onFrame?.();
      // A redraw can change scenes or start a different camera movement.
      if (this.#animation !== animation) return;
      if (finished) {
        this.#animation = null;
        onDone?.();
      } else {
        animation.frame = globalThis.requestAnimationFrame(frame);
      }
    };
    animation.frame = globalThis.requestAnimationFrame(frame);
  }

  animateTo({x = this.x, y = this.y, zoom = this.zoom}, {rect = this.#rect, duration = 240, onFrame, onDone} = {}) {
    if (!this.scene) return;
    this.cancelAnimation();
    const startX = this.x, startY = this.y, startZoom = this.zoom;
    const target = clampCenter({x, y}, this.bounds), targetZoom = this.#boundedZoom(zoom, rect);
    const distance = Math.hypot(target.x - startX, target.y - startY) * startZoom;
    if ((distance < .5 && Math.abs(targetZoom - startZoom) < .001) || !canAnimate(duration)) {
      this.x = target.x;
      this.y = target.y;
      this.zoom = targetZoom;
      onFrame?.();
      onDone?.();
      return;
    }
    this.#runAnimation(duration, t => {
      const eased = easeOutCubic(t);
      this.x = lerp(startX, target.x, eased);
      this.y = lerp(startY, target.y, eased);
      clampCenter(this, this.bounds);
      this.zoom = this.#boundedZoom(lerp(startZoom, targetZoom, eased), rect);
    }, onFrame, onDone);
  }

  startMomentum({vx = 0, vy = 0}, {duration = 220, onFrame, onDone} = {}) {
    if (!this.scene) return;
    this.cancelAnimation();
    const speed = Math.hypot(vx, vy) * this.zoom, minSpeed = .02; // CSS pixels per millisecond
    if (!Number.isFinite(speed) || speed <= minSpeed || !canAnimate(duration)) {
      onFrame?.();
      onDone?.();
      return;
    }
    const startX = this.x, startY = this.y;
    this.#runAnimation(duration, t => {
      // Integral of v(t) = v0 * (1 - t)^2, with t normalized to the duration.
      const bounds = this.bounds;
      const edge = bounds ? Math.min(timeToEdge(startX, vx, bounds.x, bounds.w), timeToEdge(startY, vy, bounds.y, bounds.h)) : Infinity;
      const travel = Math.min(edge, duration / 3 * easeOutCubic(t));
      this.x = startX + vx * travel;
      this.y = startY + vy * travel;
      clampCenter(this, bounds);
      return travel === edge || speed * (1 - t) ** 2 <= minSpeed;
    }, onFrame, onDone);
  }
}
export const viewer=new MapCamera();
