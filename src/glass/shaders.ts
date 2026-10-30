/**
 * GLSL ES 3.0 shaders. Coordinates throughout: CSS pixels, x right, y DOWN, z toward the viewer
 * (the same axes CSS 3D transforms use, so the shader camera and the HTML overlay line up).
 */

export const VS = /* glsl */ `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0., 1.); }`;

/** Draws the background texture full screen (full mode only). */
export const COPY_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uBg;
uniform vec4 uBgMap;
uniform vec2 uCanvasPx;
uniform float uPr;
void main(){
  vec2 css = vec2(gl_FragCoord.x, uCanvasPx.y - gl_FragCoord.y) / uPr;
  o = vec4(textureLod(uBg, clamp((css - uBgMap.xy) / uBgMap.zw, vec2(.001), vec2(.999)), 0.).rgb, 1.);
}`;

/** Demo background: a generated aerial beach (stand-in for the site video). */
export const BEACH_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 4; i++){ s += a * vn(p); p = m * p; a *= .5; } return s; }
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = fc / uRes.y;
  float ar = uRes.x / uRes.y, t = uTime;
  float base = mix(.24, .36, clamp((ar - .6) / 1.2, 0., 1.)) * ar;
  float shore = base + .10 * (p.y - .5) + .09 * (fbm(vec2(p.y * 1.6, 3.1)) - .5);
  float d = p.x - shore;
  float swash = .016 * sin(t * .42 + p.y * 2.4) + .010 * sin(t * .77 + p.y * 5.3);
  float dw = d + swash;
  float g1 = fbm(p * vec2(2.6, 4.2) + 7.);
  vec3 dry = mix(vec3(.86, .77, .67), vec3(.94, .88, .80), g1);
  vec3 wet = vec3(.63, .58, .52);
  vec3 sand = mix(dry, wet, smoothstep(-.085, 0., d + .02) * .8);
  sand *= .955 + .07 * vn(fc * .55);
  sand *= 1. - .03 * smoothstep(.55, .95, sin(p.x * 120. + fbm(p * 5.) * 9.));
  vec3 shallow = vec3(.53, .84, .79), mid = vec3(.17, .60, .66), deep = vec3(.06, .33, .47);
  float n2 = fbm(p * 2.2 + vec2(t * .015, 0.));
  vec3 sea = mix(shallow, mid, smoothstep(0., .22, dw));
  sea = mix(sea, deep, smoothstep(.16, .9, dw + .14 * (n2 - .5)));
  vec2 q = p * 10.;
  float c = abs(sin(q.x + fbm(q + t * .12) * 3.)) * abs(sin(q.y * 1.3 + fbm(q * 1.2 - t * .1) * 3.));
  sea += vec3(.9, 1., 1.) * pow(1. - c, 7.) * .16 * (1. - smoothstep(0., .3, dw));
  float warp = fbm(vec2(p.y * 2.6, d * 3.) + t * .04);
  float crest = pow(smoothstep(.55, 1., .5 + .5 * sin(dw * 24. + t * 1.05 + warp * 3.2)), 3.);
  float lace = smoothstep(.42, .8, fbm(p * vec2(16., 9.) + vec2(t * .25, t * .05)));
  float foam = crest * lace * (1. - smoothstep(.02, .6, dw));
  float edge = exp(-max(dw, 0.) * 65.) * smoothstep(-.003, .004, dw);
  float edgeLace = smoothstep(.28, .75, fbm(p * vec2(22., 13.) + vec2(t * .35, t * .08)));
  sea = mix(sea, vec3(.97, .99, .99), clamp(foam * .85 + edge * (.5 + .5 * edgeLace), 0., 1.));
  float w = smoothstep(-.003, .003, dw);
  vec3 col = mix(sand, sea, w);
  col = mix(col, col * vec3(.93, 1., 1.02), smoothstep(-.035, 0., dw) * (1. - w) * .7);
  vec2 v = fc / uRes - .5;
  col *= 1. - .3 * dot(v * vec2(1., 1.2), v * vec2(1., 1.2));
  o = vec4(col, 1.);
}`;

/**
 * The slab. Per pixel (1 ray, or 5 on edges):
 *  1. march the rounded box; 2. on the front face, search the relief layer (raised buttons / chiselled letters);
 *  3. Fresnel reflection of sky + scene; refraction in; march across the body with total internal reflection;
 *     refraction out of the back face (per-channel for dispersion); bubbles met on the way;
 *  4. Beer–Lambert tint, frost, cut finish, fills, glints. Background shading includes shadow + caustics.
 * Output is premultiplied: in overlay mode, background-only pixels carry shadow (alpha) and caustic light (additive rgb).
 */
export const SLAB_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uBg, uHF, uMat;
uniform vec2 uCanvasPx;
uniform float uPr;
uniform vec2 uCenter, uHalf;
uniform vec4 uHFRect, uBgMap;
uniform mat3 uR;
uniform vec3 uLight, uAbsorb, uMainA, uMainB;
uniform vec2 uShadow, uBtnScale;
uniform float uT, uRe, uRc, uCam, uFrost, uBgDist, uIor, uZTop, uZBot, uCutMatte, uMainOn, uBtn2Frost, uAA;
uniform float uSky, uDisp, uCaustic, uBubbles, uFill, uOverlay, uTime;

float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm3(vec2 p){ return .5 * vn(p) + .25 * vn(p * 2.1 + 3.7) + .125 * vn(p * 4.3 + 9.1); }

float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float sdSlab(vec3 p){
  float d2 = sdRR(p.xy, uHalf - uRe, max(uRc - uRe, 0.));
  float dz = abs(p.z + uT * .5) - (uT * .5 - uRe);
  vec2 w = vec2(d2, dz);
  return length(max(w, 0.)) + min(max(w.x, w.y), 0.) - uRe;
}
vec3 slabN(vec3 p){
  vec2 e = vec2(.2, 0.);
  return normalize(vec3(sdSlab(p + e.xyy) - sdSlab(p - e.xyy), sdSlab(p + e.yxy) - sdSlab(p - e.yxy), sdSlab(p + e.yyx) - sdSlab(p - e.yyx)));
}
vec2 hfUv(vec2 xy){ return (xy + uHalf - uHFRect.xy) / uHFRect.zw; }
bool inRect(vec2 uv){ return all(greaterThanEqual(uv, vec2(0.))) && all(lessThanEqual(uv, vec2(1.))); }
float btnScale(float id){ return id > .75 ? uBtnScale.y : (id > .2 ? uBtnScale.x : 1.); }
float surfZ(vec2 xy){
  vec2 uv = hfUv(xy);
  if (!inRect(uv)) return 0.;
  float z = texture(uHF, uv).b;
  if (z > 0.) z *= btnScale(texture(uMat, uv).g);
  return z;
}
vec3 bgAt(vec2 css, float lod){ return textureLod(uBg, clamp((css - uBgMap.xy) / uBgMap.zw, vec2(.001), vec2(.999)), lod).rgb; }

// light reaching the background: soft shadow of the slab, a bright band where the bevel focuses light,
// and caustics from the relief (domes focus, grooves spread), tinted by the glass and the blue button
vec3 lightAt(vec2 css){
  vec2 rel = css - uCenter - uShadow;
  float d = sdRR(rel, uHalf * .97, uRc);
  float sh = 1. - smoothstep(-20., 80., d);
  vec3 m = vec3(1. - .24 * sh);
  if (uCaustic > 0. && d < 40.) {
    vec3 tint = exp(-uAbsorb * uT * 2.);
    float c = exp(-pow((d + 14.) / 13., 2.)) * .36; // the bevel focuses light into a soft band, blurred by the gap
    vec2 uv = hfUv(rel);
    if (inRect(uv)) {
      // curvature of the relief, measured over a wide footprint: light spreads over the 240 px gap,
      // so the projected pattern is soft, never a crisp copy of the letters
      vec2 h = 5. / uHFRect.zw;
      float lap = 0.;
      for (int k = 0; k < 4; k++){
        vec2 j = vec2(float(k & 1), float(k >> 1)) * 2. - 1.;
        vec2 q = uv + j * h * .5;
        lap += (texture(uHF, q + vec2(h.x, 0.)).r - texture(uHF, q - vec2(h.x, 0.)).r
              + texture(uHF, q + vec2(0., h.y)).g - texture(uHF, q - vec2(0., h.y)).g) / 10.;
      }
      lap *= .25;
      c += clamp(-lap * .7, -.06, .55);
      vec4 mm = texture(uMat, uv);
      if (mm.g > .2 && mm.g < .75 && uMainOn > .5) tint *= mix(vec3(1.), mix(uMainA, uMainB, mm.a) * 1.25, .5 * smoothstep(.3, 2., texture(uHF, uv).b));
    }
    m += tint * c * uCaustic * sh;
  }
  return m;
}

vec3 studio(vec3 d){
  float up = clamp(-d.y * .5 + .5, 0., 1.);
  vec3 c = mix(vec3(.42, .52, .56), vec3(.96, .98, 1.), smoothstep(.2, .9, up));
  c += vec3(1.) * smoothstep(.86, .93, dot(d, normalize(vec3(-.35, -.55, .76)))) * 5.5;
  vec3 L = normalize(uLight);
  c += vec3(1., .98, .94) * (pow(max(dot(d, L), 0.), 400.) * 2.5 + pow(max(dot(d, L), 0.), 12.) * .1);
  return c;
}
// aerial scene: sky dome above the glass (+z), the background scene below (-z)
vec3 sky(vec3 d){
  vec3 L = normalize(uLight);
  float el = clamp(d.z, 0., 1.);
  vec3 c = mix(vec3(.82, .90, .95), vec3(.34, .57, .86), smoothstep(0., .9, el));
  vec2 cp = d.xy / (d.z + .35) * 1.6 + vec2(uTime * .01, 0.);
  float cl = smoothstep(.42, .78, fbm3(cp * 1.3));
  c = mix(c, vec3(.98, .985, 1.), cl * .8 * smoothstep(-.05, .3, d.z));
  float s = max(dot(d, L), 0.);
  c += vec3(1., .96, .88) * (pow(s, 900.) * 16. + pow(s, 50.) * .3);
  return c;
}
vec3 envAt(vec3 d, vec3 Pw){
  if (uSky < .5) return studio(d);
  if (d.z > -.02) return sky(d);
  float s = (-uBgDist - Pw.z) / d.z;
  vec3 B = Pw + d * s;
  return bgAt(uCenter + B.xy * uCam / (uCam - B.z), 1.5) * .92;
}
vec3 traceBg(vec3 Q, vec3 D, float rough, vec2 seed){
  if (D.z > -.04) return envAt(D, Q) * .85;
  float s = (-uBgDist - Q.z) / D.z;
  vec3 B = Q + D * s;
  vec2 css = uCenter + B.xy * uCam / (uCam - B.z);
  vec3 lm = lightAt(css);
  if (rough < .03) return bgAt(css, 0.) * lm;
  float lod = rough * 3.2, rad = rough * 16.;
  float a0 = hash(seed) * 6.2831853;
  vec3 acc = vec3(0.);
  for (int i = 0; i < 5; i++){
    float fi = float(i), a = a0 + fi * 2.39996;
    acc += bgAt(css + vec2(cos(a), sin(a)) * rad * sqrt((fi + .5) / 5.), lod);
  }
  return acc / 5. * lm;
}
// air bubbles sampled on three depth layers along the first pass through the body: x = dimming, y = silvery glow
vec2 bubblesAlong(vec3 q0, vec3 d0, float seg, vec3 Lloc){
  vec2 r = vec2(1., 0.);
  if (uBubbles <= 0. || seg <= 0. || abs(d0.z) < 1e-3) return r;
  for (int k = 0; k < 3; k++){
    float fk = float(k);
    float zk = -uT * (fk + .5) / 3.;
    float tk = (zk - q0.z) / d0.z;
    if (tk < 0. || tk > seg) continue;
    vec2 pk = q0.xy + d0.xy * tk;
    float cs = 22. + fk * 9.;
    vec2 off = vec2(fk * 17.3, fk * 7.9);
    vec2 cell = floor(pk / cs + off);
    vec2 rnd = hash22(cell);
    if (rnd.x > uBubbles * .35) continue;
    vec2 c = (cell + .2 + .6 * hash22(cell + 7.1) - off) * cs;
    float rad = .35 + 1.6 * rnd.y * rnd.y * rnd.y;
    vec2 v = (pk - c) / rad;
    float e = length(v);
    if (e < 1.) {
      r.x *= mix(.7, 1., smoothstep(.0, .8, e));
      r.y += smoothstep(.55, .95, e) * (1. - smoothstep(.95, 1., e)) * .35;
      r.y += smoothstep(.45, 0., length(v + Lloc.xy * .45)) * .45;
    }
  }
  return r;
}

vec4 shade(vec2 frag, out float needAA){
  needAA = 0.;
  vec3 lmBg = lightAt(frag);
  vec4 bgOut = uOverlay > .5
    ? vec4(max(lmBg - 1., 0.) * .45, clamp(1. - (lmBg.r + lmBg.g + lmBg.b) / 3., 0., .7))
    : vec4(bgAt(frag, 0.) * lmBg, 1.);

  vec2 sp = frag - uCenter;
  vec3 rdW = normalize(vec3(sp, -uCam));
  mat3 Ri = transpose(uR);
  vec3 lo = Ri * vec3(0., 0., uCam), ld = Ri * rdW;

  vec3 bmin = vec3(-uHalf, -uT - 1.), bmax = vec3(uHalf, uZTop + 1.);
  vec3 inv = 1. / ld;
  vec3 ta = (bmin - lo) * inv, tb = (bmax - lo) * inv;
  vec3 t0 = min(ta, tb), t1 = max(ta, tb);
  float tn = max(max(t0.x, t0.y), t0.z), tf = min(min(t1.x, t1.y), t1.z);
  if (tf < max(tn, 0.)) return bgOut;

  // 1) the rounded slab
  float t = max(tn, 0.), minD = 1e9;
  bool hit = false;
  for (int i = 0; i < 80; i++){
    float s = sdSlab(lo + ld * t);
    minD = min(minD, s);
    if (s < .02) { hit = true; break; }
    t += s;
    if (t > tf + 1.) break;
  }
  float px = 1. / uPr;
  if (!hit) { needAA = minD < 2.5 * px ? 1. : 0.; return bgOut; }
  vec3 p = lo + ld * t;
  vec3 N = slabN(p);
  float ao = 1., cutW = 0., btnId = 0., printM = 0., extra = 0., zHere = 0., onRelief = 0.;

  // 2) relief on the front face
  if (N.z > .9 && ld.z < -.05 && inRect(hfUv(p.xy))) {
    float tA = (uZTop - lo.z) / ld.z, tB = (uZBot - lo.z) / ld.z;
    float a = tA, b = tB;
    bool found = false;
    for (int i = 1; i <= 48; i++){
      float tt = mix(tA, tB, float(i) / 48.);
      vec3 pi = lo + ld * tt;
      if (pi.z <= surfZ(pi.xy)) { b = tt; found = true; break; }
      a = tt;
    }
    if (found) {
      for (int i = 0; i < 7; i++){
        float m = .5 * (a + b);
        vec3 pm = lo + ld * m;
        if (pm.z <= surfZ(pm.xy)) b = m; else a = m;
      }
      p = lo + ld * b;
      vec2 uv = hfUv(p.xy);
      vec4 h = texture(uHF, uv);
      vec4 m = texture(uMat, uv);
      float s = h.b > 0. ? btnScale(m.g) : 1.;
      zHere = h.b * s;
      N = normalize(vec3(-h.rg * s, 1.));
      ao = h.a; cutW = m.r; btnId = m.g; printM = m.b; extra = m.a;
      onRelief = step(.05, abs(zHere));
    }
  }
  float isBtn = step(.2, btnId), isBtn2 = step(.75, btnId), isBtn1 = isBtn * (1. - isBtn2);
  float chip = (1. - isBtn) * extra;
  float matte = cutW * uCutMatte * (1. - chip);
  float b2f = isBtn2 * uBtn2Frost;
  float rough = max(max(uFrost * .85, matte), max(printM, b2f));

  // 3) through the glass
  float cosi = clamp(-dot(ld, N), 0., 1.);
  float F = .04 + .96 * pow(1. - cosi, 5.);
  vec3 dir = refract(ld, N, 1. / uIor);
  vec3 q = p - N * .06;
  float path = 0.;
  if (q.z > -.05 && dir.z < -.01) { float tb2 = (-.08 - q.z) / dir.z; q += dir * tb2; path += tb2; }
  vec3 q0 = q, d0 = dir;
  float seg0 = -1.;
  vec3 ghost = vec3(0.);
  vec3 exitP = q, exitD = vec3(0.), exitN = vec3(0., 0., -1.);
  float edgeEntry = (1. - onRelief) * (1. - smoothstep(.55, .92, abs(N.z)));
  float bounces = 0.;
  for (int bb = 0; bb < 6; bb++){
    float tt = 0., prev = 0.;
    for (int i = 0; i < 64; i++){
      float s = -sdSlab(q + dir * tt);
      if (s < .02 && s > -.02) break;
      if (s < 0.) {
        float a = prev, c = tt;
        for (int k = 0; k < 7; k++){ float m = .5 * (a + c); if (-sdSlab(q + dir * m) > 0.) a = m; else c = m; }
        tt = c; break;
      }
      prev = tt;
      tt += max(s, .6 + tt * .03);
    }
    if (bb == 0) seg0 = tt;
    q += dir * tt; path += tt;
    vec3 Nq = slabN(q);
    vec3 outD = refract(dir, -Nq, uIor);
    if (dot(outD, outD) < 1e-5) { dir = reflect(dir, Nq); q -= Nq * .06; bounces += 1.; continue; }
    if (Nq.z < -.7) {
      vec3 r = reflect(dir, Nq);
      if (r.z > .05) {
        vec2 uv2 = hfUv(q.xy + r.xy * (-q.z / r.z));
        if (inRect(uv2)) ghost = vec3(.93, .98, 1.) * max(smoothstep(.6, 3., -texture(uHF, uv2).b), texture(uMat, uv2).b);
      }
    }
    exitP = q; exitD = outD; exitN = Nq; break;
  }

  // 4) shade
  vec3 Pw = uR * p, Nw = uR * N;
  vec3 trans;
  bool exited = dot(exitD, exitD) > 0.;
  if (exited) {
    trans = traceBg(uR * exitP, uR * exitD, rough, gl_FragCoord.xy);
    // dispersion: red and blue bend a little less / more where the faces are not parallel
    if (uDisp > 0. && bounces < .5 && rough < .35 && (N.z < .995 || exitN.z > -.995)) {
      vec3 dR = refract(ld, N, 1. / (uIor - uDisp)), dB = refract(ld, N, 1. / (uIor + uDisp));
      vec3 oR = refract(dR, -exitN, uIor - uDisp), oB = refract(dB, -exitN, uIor + uDisp);
      if (dot(oR, oR) > 0.) trans.r = traceBg(uR * exitP, uR * oR, rough, gl_FragCoord.xy).r;
      if (dot(oB, oB) > 0.) trans.b = traceBg(uR * exitP, uR * oB, rough, gl_FragCoord.xy).b;
    }
  } else trans = vec3(.16, .34, .30);
  trans *= exp(-uAbsorb * path * (1. + edgeEntry * 5.));
  trans *= 1. - .12 * min(bounces, 3.);
  vec3 Lw = normalize(uLight), Vw = normalize(vec3(0., 0., uCam) - Pw);
  vec2 bub = bubblesAlong(q0, d0, seg0, Ri * Lw);
  trans = trans * mix(1., bub.x, 1. - rough) + vec3(.95, .98, 1.) * bub.y * (1. - rough * .8);
  trans += ghost * .055 * (1. - max(matte, printM)) * (1. - uFrost * .7);
  trans = mix(trans, vec3(.95, .98, 1.), max(uFrost * .24, b2f * .38));
  vec3 tint = mix(uMainA, uMainB, extra);
  float tintK = isBtn1 * uMainOn * (1. - exp(-max(zHere, 0.) * .22)) * (.9 + .5 * (uBtnScale.x - 1.));
  trans = mix(trans, trans * tint * 1.1 + tint * .16, clamp(tintK, 0., 1.));
  trans *= mix(1., ao, .85 * (1. - chip * .8));
  trans = mix(trans, trans * 1.12 + .05, chip * .6);

  float kd = max(dot(Nw, Lw), 0.);
  float grain = hash(floor(gl_FragCoord.xy)) - .5;
  vec3 frosted = (vec3(.90, .95, .975) * (.54 + .56 * kd) + grain * .07) * ao;
  trans = mix(trans, frosted, matte * .72);
  vec3 printCol = vec3(.95, .975, 1.) * (.68 + .4 * kd) + grain * .05;
  trans = mix(trans, printCol, printM * .92);

  vec3 refl = envAt(reflect(rdW, Nw), Pw);
  float dull = max(matte, printM);
  vec3 col = mix(trans, refl, F * (1. - dull * .75));
  vec3 Hh = normalize(Lw + Vw);
  float nh = max(dot(Nw, Hh), 0.);
  float roughS = max(max(dull, uFrost * .5), b2f * .6);
  col += vec3(1., .99, .95) * (pow(nh, mix(2400., 60., roughS)) * mix(1.6, .35, roughS) + pow(nh, 90.) * .05 * (1. - dull));
  col += vec3(1.) * chip * pow(nh, 220.) * 1.2;

  // fills laid into the cut: gold leaf (metallic) or white enamel
  float fill = uFill > .5 ? cutW * (1. - chip) * smoothstep(.3, 1.2, -zHere) : 0.;
  if (fill > 0.) {
    vec3 e = envAt(reflect(rdW, Nw), Pw);
    float eL = dot(e, vec3(.3, .59, .11));
    vec3 gold = vec3(1., .77, .36);
    vec3 fc = uFill < 1.5
      ? gold * (.16 + eL * .9) * ao + vec3(1., .9, .7) * pow(nh, 140.) * 1.4 + gold * kd * .22
      : vec3(.95, .96, .94) * (.5 + .52 * kd) * ao + vec3(1.) * pow(nh, 120.) * .5;
    col = mix(col, fc, fill);
  }

  float steep = length(N.xy) / max(N.z, .05);
  needAA = onRelief > .5 ? step(.9, steep) : (N.z < .995 ? 1. : 0.);
  return vec4(clamp(col, 0., 1.), 1.);
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uCanvasPx.y - gl_FragCoord.y) / uPr;
  const vec2 OFFS[4] = vec2[4](vec2(-.375, -.125), vec2(.125, -.375), vec2(.375, .125), vec2(-.125, .375));
  vec4 c = vec4(0.);
  int n = 1;
  for (int i = 0; i < 5; i++){
    if (i >= n) break;
    float aa;
    vec2 f = i == 0 ? frag : frag + OFFS[i - 1] / uPr;
    c += shade(f, aa);
    if (i == 0 && aa > .5 && uAA > .5) n = 5;
  }
  o = c / float(n);
}`;
