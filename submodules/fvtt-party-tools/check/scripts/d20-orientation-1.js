// Icosahedral geometry shared by the standard DSN d20 and the CSS observer die.
// Only the idle pose is changed; native roll results remain authoritative.
const phi = (1 + Math.sqrt(5)) / 2;
const vertices = [[-1,phi,0],[1,phi,0],[-1,-phi,0],[1,-phi,0],[0,-1,phi],[0,1,phi],[0,-1,-phi],[0,1,-phi],[phi,0,-1],[phi,0,1],[-phi,0,-1],[-phi,0,1]];
const faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
const values = [10,17,3,16,8,7,12,20,6,19,5,18,4,11,13,15,2,14,9,1];
const sub = (a,b) => a.map((v,i) => v-b[i]);
const dot = (a,b) => a.reduce((n,v,i) => n+v*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => { const length = Math.hypot(...a); return a.map(v => v/length); };
const topFace = faces[values.indexOf(20)];
const [a,b,c] = topFace.map(i => vertices[i]);
const faceNormal = unit(cross(sub(b,a),sub(c,a)));

export function orientD20TwentyUp(mesh) {
  const vector = mesh.position.clone();
  const target = vector.clone().fromArray(faceNormal);
  const z = vector.clone().set(0,0,1);
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute?.("position"), uv = geometry?.getAttribute?.("uv");
  const index = geometry?.index;
  if (position && uv) {
    const count = index?.count ?? position.count;
    for (let offset = 0; offset < count; offset += 3) {
      const ids = [0,1,2].map(i => index ? index.getX(offset+i) : offset+i);
      const [p0,p1,p2] = ids.map(i => vector.clone().fromBufferAttribute(position,i));
      const edge1 = p1.sub(p0), edge2 = p2.sub(p0);
      const normal = edge1.clone().cross(edge2).normalize();
      if (normal.dot(target) < .9999) continue;
      const du1 = uv.getX(ids[1])-uv.getX(ids[0]), dv1 = uv.getY(ids[1])-uv.getY(ids[0]);
      const du2 = uv.getX(ids[2])-uv.getX(ids[0]), dv2 = uv.getY(ids[2])-uv.getY(ids[0]);
      const determinant = du1*dv2-du2*dv1;
      if (Math.abs(determinant) < 1e-9) continue;
      // DSN's generated atlas prints the top of each number along texture -V.
      const textUp = edge2.clone().multiplyScalar(du1).addScaledVector(edge1,-du2).divideScalar(determinant).normalize().negate();
      const x = textUp.clone().cross(normal).normalize(), y = normal.clone().cross(x).normalize();
      mesh.quaternion.setFromRotationMatrix(mesh.matrix.clone().makeBasis(x,y,normal)).invert();
      mesh.userData.bg3IdleFace = 20;
      return true;
    }
  }
  // Standard-shape fallback for skins without a readable UV-mapped geometry.
  mesh.quaternion.setFromUnitVectors(target,z);
  mesh.userData.bg3IdleFace = 20;
  return false;
}

// A real twenty-triangle CSS mesh avoids one WebGL renderer/worker per Token.
// Its face 20 remains toward the viewer while the whole die gently floats.
const right = unit(sub(c,b));
const top = unit(sub(a,b.map((v,i) => (v+c[i])/2)));
const screenVertices = vertices.map(v => [dot(v,right)*11.5,-dot(v,top)*11.5,dot(v,faceNormal)*11.5]);
const facets = faces.map((face,i) => {
  const [p0,p1,p2] = face.map(index => screenVertices[index]);
  const u = unit(sub(p2,p1)), midpoint = p1.map((v,k) => (v+p2[k])/2);
  const down = unit(sub(midpoint,p0)), n = unit(cross(u,down));
  const width = Math.hypot(...sub(p2,p1)), height = Math.hypot(...sub(midpoint,p0));
  const translate = p0.map((v,k) => v-u[k]*width/2);
  const matrix = [u[0],u[1],u[2],0,down[0],down[1],down[2],0,n[0],n[1],n[2],0,...translate,1];
  const light = Math.max(0,Math.min(1,.5+n[2]*.23-n[0]*.13-n[1]*.1));
  return {value:values[i],width,height,matrix,shade:Math.round(42+light*42)};
});

export function createMiniD20() {
  const holder = document.createElement("span");
  holder.className = "bg3-mini-die";
  holder.setAttribute("aria-hidden","true");
  const body = document.createElement("span");
  body.className = "bg3-mini-d20-mesh";
  body.dataset.topFace = "20";
  for (const facet of facets) {
    const panel = document.createElement("span");
    panel.className = `bg3-d20-facet${facet.value === 20 ? " bg3-d20-top" : ""}`;
    panel.dataset.face = String(facet.value);
    panel.style.width = `${facet.width}px`;
    panel.style.height = `${facet.height}px`;
    panel.style.transform = `matrix3d(${facet.matrix.join(",")})`;
    panel.style.setProperty("--bg3-facet-tone",`${facet.shade}%`);
    const numeral = document.createElement("span");
    numeral.textContent = String(facet.value);
    panel.append(numeral);
    body.append(panel);
  }
  holder.append(body);
  return holder;
}
