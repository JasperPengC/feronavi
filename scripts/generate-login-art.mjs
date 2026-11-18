/** 根据 Feronavi 矢量标识生成登录页立体图形，无运行时渲染依赖。 */
import { writeFileSync } from "node:fs";

const shapes = [
  [[12, 14], [40, 14], [34, 24], [22, 24], [22, 31], [36, 31], [30, 41], [22, 41], [22, 52], [12, 52]],
  [[44, 14], [56, 14], [44, 34]],
];
const radians = (angle) => angle * Math.PI / 180;
function project([u, v], depth = 0) {
  const x = (u - 32) * 9.2;
  const y = (v - 32) * 9.2;
  const yaw = radians(-24), pitch = radians(16), roll = radians(-12);
  const x1 = x * Math.cos(yaw) + depth * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + depth * Math.cos(yaw);
  const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  return [356 + x1 * Math.cos(roll) - y1 * Math.sin(roll), 270 + x1 * Math.sin(roll) + y1 * Math.cos(roll)];
}
const points = (vertices) => vertices.map((p) => p.map((n) => n.toFixed(2)).join(",")).join(" ");
const faces = [];
for (const shape of shapes) {
  for (let index = 0; index < shape.length; index++) {
    const a = shape[index], b = shape[(index + 1) % shape.length];
    faces.push(`<polygon points="${points([project(a), project(b), project(b, 46), project(a, 46)])}" fill="url(#edge-${index % 3})" stroke="#52749f" stroke-width=".4"/>`);
  }
}
const fronts = shapes.map((shape) => `<polygon points="${points(shape.map((p) => project(p, 46)))}"/>`).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="704" height="560" viewBox="0 0 704 560" fill="none">
  <defs>
    <radialGradient id="atmosphere"><stop stop-color="#274bb5" stop-opacity=".28"/><stop offset="1" stop-color="#101623" stop-opacity="0"/></radialGradient>
    <radialGradient id="floor"><stop stop-color="#5c86f7" stop-opacity=".22"/><stop offset="1" stop-color="#5c86f7" stop-opacity="0"/></radialGradient>
    <linearGradient id="metal" x1="180" y1="85" x2="460" y2="430" gradientUnits="userSpaceOnUse"><stop stop-color="#f4f9ff"/><stop offset=".24" stop-color="#c6d8f4"/><stop offset=".43" stop-color="#91afd5"/><stop offset=".54" stop-color="#d6e9fa"/><stop offset=".64" stop-color="#b9d5ec"/><stop offset="1" stop-color="#6185b5"/></linearGradient>
    <linearGradient id="rim" x1="190" y1="90" x2="440" y2="420" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".47" stop-color="#c4dfff"/><stop offset="1" stop-color="#647aaf"/></linearGradient>
    <linearGradient id="edge-0" x1="180" y1="80" x2="440" y2="460" gradientUnits="userSpaceOnUse"><stop stop-color="#a4bedc"/><stop offset=".4" stop-color="#5273a3"/><stop offset="1" stop-color="#1e3159"/></linearGradient>
    <linearGradient id="edge-1" x1="200" y1="100" x2="360" y2="420" gradientUnits="userSpaceOnUse"><stop stop-color="#435d8e"/><stop offset=".5" stop-color="#1c3157"/><stop offset="1" stop-color="#152541"/></linearGradient>
    <linearGradient id="edge-2" x1="180" y1="100" x2="500" y2="400" gradientUnits="userSpaceOnUse"><stop stop-color="#7f9dc3"/><stop offset=".5" stop-color="#3d5791"/><stop offset="1" stop-color="#29416a"/></linearGradient>
    <linearGradient id="reflection" x1="150" y1="140" x2="440" y2="370" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".38"/><stop offset=".66" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="cast-shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
    <clipPath id="front">${fronts}</clipPath>
  </defs>
  <ellipse cx="332" cy="270" rx="306" ry="254" fill="url(#atmosphere)"/>
  <ellipse cx="348" cy="464" rx="212" ry="44" fill="url(#floor)"/>
  <ellipse cx="340" cy="467" rx="116" ry="13" fill="#020711" opacity=".82" filter="url(#cast-shadow)"/>
  <g>${faces.join("")}</g>
  <g fill="url(#metal)" stroke="url(#rim)" stroke-width="1.2" stroke-linejoin="round">${fronts}</g>
  <rect x="100" y="40" width="470" height="440" fill="url(#reflection)" clip-path="url(#front)"/>
</svg>\n`;
writeFileSync(new URL("../public/brand/login-sculpture.svg", import.meta.url), svg);
const light = svg
  .replace('stop-color="#274bb5" stop-opacity=".28"', 'stop-color="#a5bce7" stop-opacity=".28"')
  .replace('stop-color="#101623" stop-opacity="0"', 'stop-color="#f4f6fb" stop-opacity="0"')
  .replace('fill="#020711" opacity=".82"', 'fill="#364e7b" opacity=".3"')
  .replace('stop-color="#f4f9ff"', 'stop-color="#b5c9eb"')
  .replace('stop-color="#c6d8f4"', 'stop-color="#718dbb"')
  .replace('stop-color="#91afd5"', 'stop-color="#46628d"')
  .replace('stop-color="#d6e9fa"', 'stop-color="#c4d6ed"')
  .replace('stop-color="#b9d5ec"', 'stop-color="#7d9cc2"')
  .replace('stop-color="#6185b5"', 'stop-color="#3b5782"');
writeFileSync(new URL("../public/brand/login-sculpture-light.svg", import.meta.url), light);
