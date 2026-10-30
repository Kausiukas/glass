// src/glass/shaders.ts
var VS = (
  /* glsl */
  `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0., 1.); }`
);
var COPY_FS = (
  /* glsl */
  `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uBg;
uniform vec4 uBgMap;
uniform vec2 uCanvasPx;
uniform float uPr;
void main(){
  vec2 css = vec2(gl_FragCoord.x, uCanvasPx.y - gl_FragCoord.y) / uPr;
  o = vec4(textureLod(uBg, clamp((css - uBgMap.xy) / uBgMap.zw, vec2(.001), vec2(.999)), 0.).rgb, 1.);
}`
);
var BEACH_FS = (
  /* glsl */
  `#version 300 es
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
}`
);
var SLAB_FS = (
  /* glsl */
  `#version 300 es
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
}`
);

// src/glass/options.ts
var DEFAULTS = {
  thickness: 44,
  frost: 0.14,
  edgeRadius: 10,
  cornerRadius: 28,
  glass: "float",
  ior: 1.5,
  reflections: "sky",
  sunAzimuth: 236,
  sunElevation: 41,
  dispersion: 0.35,
  caustics: 0.4,
  bubbles: 0.12,
  tool: "gouge",
  wallAngle: 52,
  maxDepth: 14,
  chips: 0.35,
  wobble: 0.4,
  finish: 0.45,
  fill: "none",
  smallLine: "print",
  buttonHeight: 12,
  buttonShape: "pillow",
  buttonEdge: 12,
  mainColor: "brand",
  secondary: "clear",
  view: "pointer",
  restTilt: [11, -16],
  maxTilt: [16, 22],
  camera: 1500,
  quality: "auto",
  antialias: true,
  respectReducedMotion: true
};
var RELIEF_KEYS = [
  "tool",
  "wallAngle",
  "maxDepth",
  "chips",
  "wobble",
  "smallLine",
  "buttonHeight",
  "buttonShape",
  "buttonEdge",
  "quality"
];
var LETTER_STYLES = {
  hand: { tool: "gouge", wallAngle: 52, maxDepth: 14, chips: 0.35, wobble: 0.4, finish: 0.45 },
  crystal: { tool: "vee", wallAngle: 46, maxDepth: 16, chips: 0.12, wobble: 0.08, finish: 0 },
  laser: { tool: "sand", wallAngle: 80, maxDepth: 12, chips: 0, wobble: 0, finish: 0.7 }
};
var SLAB_PRESETS = {
  pane: { thickness: 12, frost: 0.62, edgeRadius: 4, glass: "clear", bubbles: 0 },
  plate: { thickness: 44, frost: 0.14, edgeRadius: 10, glass: "float", bubbles: 0.12 },
  block: { thickness: 96, frost: 0, edgeRadius: 18, glass: "sea", bubbles: 0.3 }
};
var ABSORB = {
  float: [4e-3, 1e-3, 29e-4],
  clear: [9e-4, 6e-4, 7e-4],
  sea: [62e-4, 17e-4, 13e-4]
};
var MAIN_TINT = {
  brand: [[0.133, 0.341, 1], [0.357, 0.235, 1], 1],
  cobalt: [[0.1, 0.22, 0.86], [0.06, 0.15, 0.72], 1],
  clear: [[1, 1, 1], [1, 1, 1], 0]
};

// src/glass/relief.ts
function transformChar(ch, mode, prev) {
  if (mode === "uppercase") return ch.toUpperCase();
  if (mode === "lowercase") return ch.toLowerCase();
  if (mode === "capitalize" && (prev === "" || /\s/.test(prev))) return ch.toUpperCase();
  return ch;
}
function collectGlyphs(root, slabRect, out) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node;
  while (node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent) continue;
    const cs = getComputedStyle(parent);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const fs = parseFloat(cs.fontSize);
    const text = node.textContent ?? "";
    let i = 0, prev = "";
    for (const ch of text) {
      const len = ch.length;
      if (!/\s/.test(ch)) {
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          out.push({
            ch: transformChar(ch, cs.textTransform, prev),
            x: r.left - slabRect.left,
            y: r.top - slabRect.top,
            h: r.height,
            style: cs.fontStyle,
            weight: cs.fontWeight,
            family: cs.fontFamily,
            fs
          });
        }
      }
      prev = ch;
      i += len;
    }
  }
}
function buildReliefRequest(slab, o, maxScale) {
  const cutGlyphs = [], printGlyphs = [];
  const cssRects = [];
  let fsMax = 10, W = 0, H = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  const prevTransform = slab.style.transform;
  slab.style.transform = "none";
  try {
    const sr = slab.getBoundingClientRect();
    W = sr.width;
    H = sr.height;
    if (W < 10 || H < 10) return null;
    const grow = (r) => {
      bx0 = Math.min(bx0, r.left - sr.left);
      by0 = Math.min(by0, r.top - sr.top);
      bx1 = Math.max(bx1, r.right - sr.left);
      by1 = Math.max(by1, r.bottom - sr.top);
    };
    slab.querySelectorAll("[data-glass-carve]").forEach((el) => {
      const toPrint = el.hasAttribute("data-glass-small") && o.smallLine === "print";
      collectGlyphs(el, sr, toPrint ? printGlyphs : cutGlyphs);
      grow(el.getBoundingClientRect());
      if (!toPrint) fsMax = Math.max(fsMax, parseFloat(getComputedStyle(el).fontSize));
    });
    slab.querySelectorAll("[data-glass-button]").forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.width < 1) return;
      grow(r);
      cssRects.push({
        x: r.left - sr.left,
        y: r.top - sr.top,
        w: r.width,
        h: r.height,
        rad: parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0,
        id: Number(b.dataset.glassButton) === 2 ? 2 : 1
      });
      collectGlyphs(b.querySelector("[data-glass-label]") ?? b, sr, printGlyphs);
    });
  } finally {
    slab.style.transform = prevTransform;
  }
  if (!isFinite(bx0)) return null;
  const pad = 22;
  const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad);
  const x1 = Math.min(W, bx1 + pad), y1 = Math.min(H, by1 + pad);
  let sc = Math.min(devicePixelRatio || 1, maxScale);
  const area = (x1 - x0) * (y1 - y0), cap = o.quality === "full" ? 18e5 : 12e5;
  if (area * sc * sc > cap) sc = Math.sqrt(cap / area);
  const tw = Math.max(2, Math.round((x1 - x0) * sc)), th = Math.max(2, Math.round((y1 - y0) * sc));
  const N = tw * th;
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const raster = (glyphs) => {
    ctx.clearRect(0, 0, tw, th);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "alphabetic";
    let font = "", asc = 0;
    for (const g of glyphs) {
      const f = `${g.style} ${g.weight} ${g.fs * sc}px ${g.family}`;
      if (f !== font) {
        font = f;
        ctx.font = f;
        const m = ctx.measureText("Hg");
        asc = m.fontBoundingBoxAscent ?? 0;
      }
      ctx.fillText(g.ch, (g.x - x0) * sc, (g.y - y0) * sc + (asc || g.h * sc * 0.75));
    }
    const d = ctx.getImageData(0, 0, tw, th).data;
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = d[i * 4 + 3] / 255;
    return a;
  };
  const cutA = raster(cutGlyphs);
  const printA = raster(printGlyphs);
  const rects = cssRects.map((r) => ({
    x: (r.x - x0) * sc,
    y: (r.y - y0) * sc,
    w: r.w * sc,
    h: r.h * sc,
    rad: r.rad * sc,
    id: r.id
  }));
  return {
    input: {
      tw,
      th,
      sc,
      x0,
      y0,
      cutA,
      printA,
      fsMax,
      rects,
      params: {
        tool: o.tool,
        wallAngle: o.wallAngle,
        maxDepth: o.maxDepth,
        chips: o.chips,
        wobble: o.wobble,
        buttonHeight: o.buttonHeight,
        buttonShape: o.buttonShape,
        buttonEdge: o.buttonEdge
      }
    },
    rect: [x0, y0, x1 - x0, y1 - y0]
  };
}

// src/glass/reliefCore.ts
var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
var smooth01 = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};
function blurH(s, d, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += s[o + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      d[o + x] = acc * inv;
      acc += s[o + Math.min(w - 1, x + r + 1)] - s[o + Math.max(0, x - r)];
    }
  }
}
function blurV(s, d, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += s[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      d[y * w + x] = acc * inv;
      acc += s[Math.min(h - 1, y + r + 1) * w + x] - s[Math.max(0, y - r) * w + x];
    }
  }
}
function blur3(a, w, h, r) {
  const t = new Float32Array(a.length), u = new Float32Array(a.length);
  let s = a;
  for (let i = 0; i < 3; i++) {
    blurH(s, t, w, h, r);
    blurV(t, u, w, h, r);
    s = u;
  }
  return u;
}
function edt1d(g, len, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e30;
  z[1] = 1e30;
  for (let q = 1; q < len; q++) {
    let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < len; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + g[r];
  }
}
function edt2d(f, w, h) {
  const n = Math.max(w, h);
  const g = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) g[y] = f[y * w + x];
    edt1d(g, h, d, v, z);
    for (let y = 0; y < h; y++) f[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) g[x] = f[o + x];
    edt1d(g, w, d, v, z);
    for (let x = 0; x < w; x++) f[o + x] = d[x];
  }
}
function maxFilter(src, w, h, R) {
  const W = 2 * R + 1, n = Math.max(w, h) + 2 * R;
  const pad = new Float32Array(n), g = new Float32Array(n), hh = new Float32Array(n);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const run = (len) => {
    const L = len + 2 * R;
    for (let i = 0; i < L; i++) g[i] = i % W === 0 ? pad[i] : Math.max(g[i - 1], pad[i]);
    for (let i = L - 1; i >= 0; i--) hh[i] = i === L - 1 || (i + 1) % W === 0 ? pad[i] : Math.max(hh[i + 1], pad[i]);
  };
  for (let y = 0; y < h; y++) {
    const o = y * w;
    pad.fill(0, 0, w + 2 * R);
    for (let x = 0; x < w; x++) pad[x + R] = src[o + x];
    run(w);
    for (let x = 0; x < w; x++) tmp[o + x] = Math.max(hh[x], g[x + W - 1]);
  }
  for (let x = 0; x < w; x++) {
    pad.fill(0, 0, h + 2 * R);
    for (let y = 0; y < h; y++) pad[y + R] = tmp[y * w + x];
    run(h);
    for (let y = 0; y < h; y++) out[y * w + x] = Math.max(hh[y], g[y + W - 1]);
  }
  return out;
}
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function computeRelief(inp) {
  const { tw, th, sc, x0, y0, cutA, printA, fsMax, rects, params } = inp;
  const N = tw * th;
  const fA = new Float64Array(N), fB = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ins = cutA[i] >= 0.5;
    fA[i] = ins ? 1e12 : 0;
    fB[i] = ins ? 0 : 1e12;
  }
  edt2d(fA, tw, th);
  edt2d(fB, tw, th);
  const sd = new Float32Array(N), dIn = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = cutA[i];
    let s = a >= 0.5 ? Math.sqrt(fA[i]) - 0.5 : -(Math.sqrt(fB[i]) - 0.5);
    if (a > 0 && a < 1 && Math.abs(s) < 1.2) s = a - 0.5;
    sd[i] = s;
    dIn[i] = s > 0 ? s : 0;
  }
  const wloc = maxFilter(dIn, tw, th, Math.max(2, Math.ceil(0.13 * fsMax * sc)));
  const tanA = Math.tan(params.wallAngle * Math.PI / 180), maxD = params.maxDepth;
  const wob = params.wobble, chips = params.chips, tool = params.tool;
  const csz = 3 + 5 * chips;
  const chipD = Math.min(maxD * 0.35, 0.5 + 1.5 * chips);
  const reach = (csz * 1.6 + 2) * sc;
  const hCut = new Float32Array(N), cutW = new Float32Array(N), chipW = new Float32Array(N);
  let deepest = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x;
    let s = sd[i];
    if (s < -reach) continue;
    const X = x / sc + x0, Y = y / sc + y0;
    if (wob > 0) s += wob * 0.75 * sc * ((vnoise(X / 7, Y / 7) - 0.5) * 2 + (vnoise(X / 2.6 + 31, Y / 2.6) - 0.5) * 0.8);
    let h = 0;
    if (s > 0) {
      const w = Math.max(wloc[i], 1), u = Math.min(s / w, 1), wc = w / sc;
      if (tool === "sand") {
        const D = maxD * 0.6, r = clamp(s / sc * tanA / D, 0, 1);
        h = D * r * r * (3 - 2 * r);
      } else {
        let D = Math.min(maxD, tanA * wc);
        if (wob > 0) D *= 1 + wob * 0.3 * (vnoise(X / 34 + 7, Y / 34) - 0.5) * 2;
        h = tool === "gouge" ? D * (1 - (1 - u) * (1 - u)) : D * u;
        if (wob > 0) h += wob * 0.32 * (vnoise(X / 3.6 + 91, Y / 3.6) - 0.5) * 2 * 4 * u * (1 - u) * Math.min(D / 5, 1);
      }
      cutW[i] = Math.min(1, s + 0.5);
    }
    if (chips > 0) {
      const n1 = vnoise(X / (csz * 1.6) + 113, Y / (csz * 1.6) + 7);
      const m = smooth01((n1 - (1 - chips * 0.55)) / 0.06);
      if (m > 0) {
        const jag = 0.65 + 0.35 * vnoise(X / 1.3 + 57, Y / 1.3 + 3);
        const rch = csz * sc * (0.5 + 0.8 * n1) * jag;
        let hc = 0;
        if (s < 0) {
          const q = -s / rch;
          if (q < 1) hc = chipD * m * (1 - q * q * q) * (0.9 + 0.1 * Math.cos(q * 9 + n1 * 5));
        } else hc = chipD * m * (1 - smooth01(s / Math.max(rch, 1)));
        if (hc > h) {
          h = hc;
          chipW[i] = Math.min(1, hc / 0.5);
          cutW[i] *= 0.3;
        }
      }
    }
    hCut[i] = h;
    if (h > deepest) deepest = h;
  }
  const zB = new Float32Array(N), bid = new Uint8Array(N), bu = new Float32Array(N);
  const Hb = params.buttonHeight, Bw = params.buttonEdge, shape = params.buttonShape;
  for (const r of rects) {
    const xa = Math.max(0, Math.floor(r.x - 1)), xb = Math.min(tw, Math.ceil(r.x + r.w + 1));
    const ya = Math.max(0, Math.floor(r.y - 1)), yb = Math.min(th, Math.ceil(r.y + r.h + 1));
    const halfH = r.h / 2 / sc, cx = r.x + r.w / 2, cy = r.y + r.h / 2, rr = Math.min(r.rad, r.w / 2, r.h / 2);
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const i = y * tw + x;
      const qx = Math.abs(x + 0.5 - cx) - r.w / 2 + rr, qy = Math.abs(y + 0.5 - cy) - r.h / 2 + rr;
      const sdist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
      const a = clamp(0.5 - sdist, 0, 1);
      if (a <= 0) continue;
      const d = Math.max(-sdist, 0) / sc;
      let z2;
      if (shape === "dome") {
        const s = Math.min(d / halfH, 1);
        z2 = Hb * Math.sqrt(1 - (1 - s) * (1 - s));
      } else if (shape === "bevel") z2 = Hb * Math.min(d / Bw, 1);
      else {
        const s = Math.min(d / Bw, 1);
        z2 = Hb * Math.sqrt(1 - (1 - s) * (1 - s));
      }
      zB[i] = z2 * Math.min(1, a * 1.6);
      bid[i] = r.id === 1 ? 128 : 255;
      bu[i] = clamp((x - r.x) / r.w, 0, 1);
    }
  }
  const z = new Float32Array(N);
  for (let i = 0; i < N; i++) z[i] = zB[i] - hCut[i] - 0.6 * printA[i];
  const tmp = new Float32Array(N), zs = new Float32Array(N);
  blurH(z, tmp, tw, th, 1);
  blurV(tmp, zs, tw, th, 1);
  const zb = blur3(zs, tw, th, Math.max(2, Math.round(5 * sc)));
  const hf = new Float32Array(N * 4), mat = new Uint8Array(N * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x;
    const xl = x > 0 ? i - 1 : i, xr = x < tw - 1 ? i + 1 : i, yu = y > 0 ? i - tw : i, yd = y < th - 1 ? i + tw : i;
    hf[i * 4] = (zs[xr] - zs[xl]) * 0.5 * sc;
    hf[i * 4 + 1] = (zs[yd] - zs[yu]) * 0.5 * sc;
    hf[i * 4 + 2] = zs[i];
    hf[i * 4 + 3] = clamp(1 - 0.085 * Math.max(zb[i] - zs[i], 0), 0.5, 1);
    mat[i * 4] = Math.round(cutW[i] * 255);
    mat[i * 4 + 1] = bid[i];
    mat[i * 4 + 2] = Math.round(printA[i] * 255);
    mat[i * 4 + 3] = Math.round((bid[i] ? bu[i] : chipW[i]) * 255);
  }
  return { hf, mat, deepest, tw, th };
}

// src/glass/GlassSlab.ts
var clamp2 = (v, a, b) => Math.max(a, Math.min(b, v));
var lerp = (a, b, t) => a + (b - a) * t;
function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "a");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program link failed");
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}
function rotMat(rx, ry) {
  const a = rx * Math.PI / 180, b = ry * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const X = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]];
  const Y = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]];
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) M[i][j] += X[i][k] * Y[k][j];
  return new Float32Array([M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]);
}
var GlassSlab = class {
  constructor(init) {
    /** False when WebGL2 is unavailable; the host then carries data-glass="off" for CSS fallbacks. */
    this.ok = false;
    this.gl = null;
    this.progs = null;
    this.tex = null;
    this.fbo = null;
    this.vbo = null;
    this.bgW = 2;
    this.bgH = 2;
    this.bgSource = "beach";
    this.bgFit = "viewport";
    this.bgDirty = true;
    this.bgPaused = false;
    this.mediaReady = false;
    this.hasVFC = false;
    this.videoFrameNew = true;
    this.vfcVideo = null;
    this.vfcHandle = 0;
    this.relief = null;
    this.reliefRect = [0, 0, 1, 1];
    this.zBot = -16;
    this.reliefMs = 0;
    this.worker = null;
    this.jobId = 0;
    this.busy = false;
    this.pending = false;
    this.jobRect = [0, 0, 1, 1];
    this.jobT0 = 0;
    this.reliefTimer = 0;
    this.ppc = 1.5;
    this.calmUntil = 0;
    this.slow = 0;
    this.fast = 0;
    this.raf = 0;
    this.running = false;
    this.lost = false;
    this.dirty = true;
    this.live = false;
    this.tilt = { rx: 0, ry: 0 };
    this.lastTransform = "";
    this.pointer = { x: 0, y: 0, active: false };
    this.orient = null;
    this.btn = { 1: { hover: false, press: false, s: 1 }, 2: { hover: false, press: false, s: 1 } };
    this.visible = true;
    this.lastHost = "";
    this.parked = false;
    this.frames = 0;
    this.fpsT = 0;
    this.fps = 0;
    this.statsT = 0;
    this.cleanup = [];
    this.onWorker = (e) => {
      this.busy = false;
      const { id, out, error } = e.data;
      if (error) this.err("Relief worker: " + error);
      else if (out && id === this.jobId) this.applyRelief(out, this.jobRect, this.jobT0);
      if (this.pending) {
        this.pending = false;
        this.runRelief();
      }
    };
    this.frame = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this.frame);
      this.frames++;
      if (t - this.fpsT > 1e3) {
        this.fps = Math.round(this.frames * 1e3 / (t - this.fpsT));
        this.frames = 0;
        this.fpsT = t;
        if (this.ok && this.o.quality === "auto" && this.live && t > this.calmUntil) {
          this.slow = this.fps < 30 ? this.slow + 1 : 0;
          this.fast = this.fps > 55 ? this.fast + 1 : 0;
          if (this.slow >= 2 && this.ppc > this.minPPC()) {
            this.ppc = Math.max(this.minPPC(), this.ppc * 0.85);
            this.slow = 0;
            this.resize();
          } else if (this.fast >= 3 && this.ppc < this.maxPPC()) {
            this.ppc = Math.min(this.maxPPC(), this.ppc * 1.12);
            this.fast = 0;
            this.resize();
          }
        }
      }
      const r = this.host.getBoundingClientRect();
      const tg = this.targetTilt(t, r);
      const k = this.effectiveView() === "pointer" && (this.pointer.active || this.orient) ? 0.14 : 0.06;
      const rx = lerp(this.tilt.rx, tg.rx, k), ry = lerp(this.tilt.ry, tg.ry, k);
      const moving = Math.abs(rx - this.tilt.rx) + Math.abs(ry - this.tilt.ry) > 3e-3;
      this.tilt = { rx, ry };
      const tr = `perspective(${this.o.camera}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (tr !== this.lastTransform) {
        this.slab.style.transform = tr;
        this.lastTransform = tr;
      }
      let btnMoving = false;
      for (const id of [1, 2]) {
        const b = this.btn[id];
        const target = b.press ? 0.4 : b.hover ? 1.25 : 1;
        const ns = lerp(b.s, target, 0.22);
        if (Math.abs(ns - b.s) > 1e-3) btnMoving = true;
        b.s = Math.abs(ns - target) < 1e-3 ? target : ns;
      }
      const hostKey = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`;
      const moved = hostKey !== this.lastHost;
      this.lastHost = hostKey;
      const src = this.bgSource;
      const beachLive = src === "beach" && !this.bgPaused;
      const videoLive = src instanceof HTMLVideoElement && !src.paused && (!this.hasVFC || this.videoFrameNew);
      const offscreen = !this.visible || r.bottom < -200 || r.top > this.viewSize()[1] + 200;
      const need = this.mode === "overlay" && offscreen ? !this.parked : this.dirty || moving || btnMoving || moved || beachLive || videoLive || this.bgDirty;
      this.live = need;
      if (need && this.ok && !this.lost && document.visibilityState !== "hidden") {
        this.dirty = false;
        this.videoFrameNew = false;
        try {
          this.draw(t, r);
        } catch (e) {
          this.err("Render: " + e.message);
        }
      }
      if (this.onStats && t - this.statsT > 250) {
        this.statsT = t;
        this.onStats({ fps: this.fps, resolution: this.ppc, reliefMs: this.reliefMs, live: this.live, webgl: this.ok, tiltX: rx, tiltY: ry });
      }
    };
    this.canvas = init.canvas;
    this.host = init.host;
    this.slab = init.slab;
    this.mode = init.mode ?? "full";
    this.o = { ...DEFAULTS, ...init.options };
    this.onStats = init.onStats;
    this.onError = init.onError;
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.bgPaused = this.reduced && this.o.respectReducedMotion;
    this.tilt = { rx: this.o.restTilt[0], ry: this.o.restTilt[1] };
    if (init.createWorker) {
      try {
        this.worker = init.createWorker();
        this.worker.onmessage = this.onWorker;
        this.worker.onerror = () => {
          this.worker?.terminate();
          this.worker = null;
          this.busy = false;
          this.scheduleRelief(0);
        };
      } catch {
        this.worker = null;
      }
    }
    this.ok = this.initGL();
    this.host.dataset.glass = this.ok ? "on" : "off";
    this.bindEvents();
    this.setBackground(init.background ?? "beach", init.backgroundFit ?? (this.mode === "overlay" ? "element" : "viewport"));
    if (this.ok) {
      this.ppc = this.maxPPC();
      this.calmUntil = performance.now() + 3e3;
      this.resize();
    }
    const fonts = document.fonts;
    if (fonts?.ready) fonts.ready.then(() => this.scheduleRelief(0));
    else this.scheduleRelief(0);
  }
  // ───────────────────────── public API ─────────────────────────
  start() {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  getOptions() {
    return { ...this.o, restTilt: [...this.o.restTilt], maxTilt: [...this.o.maxTilt] };
  }
  setOptions(p) {
    let relief = false;
    for (const k of Object.keys(p)) {
      if (p[k] === void 0) continue;
      if (JSON.stringify(this.o[k]) !== JSON.stringify(p[k]) && RELIEF_KEYS.includes(k)) relief = true;
    }
    const qualityChanged = p.quality !== void 0 && p.quality !== this.o.quality;
    this.o = { ...this.o, ...p };
    if (qualityChanged) {
      this.ppc = this.maxPPC();
      this.slow = this.fast = 0;
      this.calmUntil = performance.now() + 2500;
      this.resize();
    }
    if (relief) this.scheduleRelief(30);
    this.dirty = true;
  }
  setBackground(src, fit) {
    if (this.vfcVideo && this.vfcHandle) this.vfcVideo.cancelVideoFrameCallback?.(this.vfcHandle);
    this.vfcVideo = null;
    this.vfcHandle = 0;
    this.hasVFC = false;
    this.bgSource = src;
    if (fit) this.bgFit = fit;
    this.mediaReady = false;
    this.bgDirty = true;
    this.dirty = true;
    if (src instanceof HTMLVideoElement) {
      const v = src;
      if (typeof v.requestVideoFrameCallback === "function") {
        this.hasVFC = true;
        this.vfcVideo = src;
        const cb = () => {
          this.videoFrameNew = true;
          this.vfcHandle = v.requestVideoFrameCallback(cb);
        };
        this.vfcHandle = v.requestVideoFrameCallback(cb);
      }
      src.addEventListener("loadeddata", () => {
        this.bgDirty = true;
        this.dirty = true;
      }, { once: true });
    } else if (src instanceof HTMLImageElement && !src.complete) {
      src.addEventListener("load", () => {
        this.bgDirty = true;
        this.dirty = true;
      }, { once: true });
    }
  }
  /** Freeze or resume the built-in demo beach animation. */
  pauseBackground(paused) {
    this.bgPaused = paused;
    this.dirty = true;
  }
  /** Rebuild the relief now (it also rebuilds automatically on text, size and font changes). */
  rebuildRelief() {
    this.scheduleRelief(0);
  }
  /** Phones: tilt with the device. iOS needs this to be called from a user gesture. Returns false if refused. */
  async enableDeviceTilt() {
    const D = window.DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === "function") {
      try {
        if (await D.requestPermission() !== "granted") return false;
      } catch {
        return false;
      }
    }
    const on = (e) => {
      if (e.beta == null || e.gamma == null) return;
      this.orient = { ny: clamp2((e.beta - 45) / 25, -1.2, 1.2), nx: clamp2(e.gamma / 25, -1.2, 1.2), at: performance.now() };
    };
    window.addEventListener("deviceorientation", on);
    this.cleanup.push(() => window.removeEventListener("deviceorientation", on));
    return true;
  }
  /**
   * Render a high-resolution still (for a poster image, social preview or the no-WebGL fallback).
   * crop "slab" returns the slab plus shadow margin; in overlay mode the PNG has transparency.
   */
  async renderStill(opts = {}) {
    if (!this.ok || !this.gl) throw new Error("WebGL2 is not available");
    const prev = this.ppc;
    this.ppc = Math.min(4, (devicePixelRatio || 1) * clamp2(opts.scale ?? 2, 1, 3));
    this.resize();
    const r = this.host.getBoundingClientRect();
    this.draw(performance.now(), r);
    const [VW, VH] = this.viewSize();
    const pr = this.canvas.width / VW;
    const out = document.createElement("canvas");
    if ((opts.crop ?? "slab") === "slab") {
      const m = opts.margin ?? 90;
      const x0 = clamp2(r.left - m, 0, VW), y0 = clamp2(r.top - m, 0, VH), x1 = clamp2(r.right + m, 0, VW), y1 = clamp2(r.bottom + m, 0, VH);
      out.width = Math.round((x1 - x0) * pr);
      out.height = Math.round((y1 - y0) * pr);
      out.getContext("2d").drawImage(this.canvas, x0 * pr, y0 * pr, out.width, out.height, 0, 0, out.width, out.height);
    } else {
      out.width = this.canvas.width;
      out.height = this.canvas.height;
      out.getContext("2d").drawImage(this.canvas, 0, 0);
    }
    this.ppc = prev;
    this.resize();
    this.dirty = true;
    return new Promise((res, rej) => out.toBlob((b) => b ? res(b) : rej(new Error("toBlob failed")), "image/png"));
  }
  dispose() {
    this.stop();
    clearTimeout(this.reliefTimer);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.setBackground("beach");
    this.worker?.terminate();
    this.worker = null;
    const gl = this.gl;
    if (gl && this.tex && this.progs) {
      Object.values(this.tex).forEach((t) => gl.deleteTexture(t));
      Object.values(this.progs).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteFramebuffer(this.fbo);
      gl.deleteBuffer(this.vbo);
    }
    this.slab.style.transform = "";
    delete this.host.dataset.glass;
  }
  // ───────────────────────── setup ─────────────────────────
  err(m) {
    if (this.onError) this.onError(m);
    else console.warn("[GlassSlab]", m);
  }
  initGL() {
    try {
      const attrs = this.mode === "overlay" ? { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "high-performance" } : { alpha: false, antialias: false, powerPreference: "high-performance" };
      const gl = this.canvas.getContext("webgl2", attrs);
      if (!gl) throw new Error("WebGL2 is not available in this browser");
      this.gl = gl;
      this.progs = { copy: compile(gl, VS, COPY_FS), beach: compile(gl, VS, BEACH_FS), slab: compile(gl, VS, SLAB_FS) };
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const mk = (minFilter) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        return t;
      };
      this.tex = { beach: mk(gl.LINEAR_MIPMAP_LINEAR), media: mk(gl.LINEAR_MIPMAP_LINEAR), hf: mk(gl.LINEAR), mat: mk(gl.LINEAR) };
      gl.bindTexture(gl.TEXTURE_2D, this.tex.media);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.hf);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([0, 0, 0, 1]));
      gl.bindTexture(gl.TEXTURE_2D, this.tex.mat);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      this.fbo = gl.createFramebuffer();
      if (this.relief) this.uploadRelief(this.relief);
      this.bgDirty = true;
      this.dirty = true;
      return true;
    } catch (e) {
      this.err(e.message);
      return false;
    }
  }
  bindEvents() {
    const on = (t, type, fn, opts) => {
      t.addEventListener(type, fn, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn, opts));
    };
    const setPointer = (e) => {
      const p = e;
      this.pointer.x = p.clientX;
      this.pointer.y = p.clientY;
      this.pointer.active = true;
    };
    on(window, "pointermove", setPointer, { passive: true });
    on(window, "pointerdown", setPointer, { passive: true });
    on(document.documentElement, "mouseleave", () => {
      this.pointer.active = false;
    });
    on(window, "blur", () => {
      this.pointer.active = false;
    });
    on(window, "resize", () => {
      this.resize();
      this.scheduleRelief();
    });
    on(this.canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    on(this.canvas, "webglcontextrestored", () => {
      this.lost = false;
      this.ok = this.initGL();
      this.host.dataset.glass = this.ok ? "on" : "off";
      this.resize();
    });
    on(document, "visibilitychange", () => {
      this.dirty = true;
    });
    const fonts = document.fonts;
    if (fonts) on(fonts, "loadingdone", () => this.scheduleRelief());
    const btnOf = (e) => e.target?.closest?.("[data-glass-button]");
    const st = (b) => this.btn[b.dataset.glassButton === "2" ? 2 : 1];
    on(this.slab, "pointerover", (e) => {
      const b = btnOf(e);
      if (b) st(b).hover = true;
    });
    on(this.slab, "pointerout", (e) => {
      const b = btnOf(e);
      if (!b) return;
      const rel = e.relatedTarget;
      if (!rel || !b.contains(rel)) {
        st(b).hover = false;
        st(b).press = false;
      }
    });
    on(this.slab, "pointerdown", (e) => {
      const b = btnOf(e);
      if (b) st(b).press = true;
    });
    on(window, "pointerup", () => {
      this.btn[1].press = false;
      this.btn[2].press = false;
    });
    on(this.slab, "focusin", (e) => {
      const b = btnOf(e);
      if (b) st(b).hover = true;
    });
    on(this.slab, "focusout", (e) => {
      const b = btnOf(e);
      if (b) st(b).hover = false;
    });
    on(this.slab, "keydown", (e) => {
      const k = e.key, b = btnOf(e);
      if (b && (k === "Enter" || k === " ")) {
        st(b).press = true;
        setTimeout(() => {
          st(b).press = false;
        }, 160);
      }
    });
    const ro = new ResizeObserver(() => {
      this.scheduleRelief();
      this.dirty = true;
    });
    ro.observe(this.slab);
    const mo = new MutationObserver(() => this.scheduleRelief());
    mo.observe(this.slab, { subtree: true, childList: true, characterData: true });
    const io = new IntersectionObserver((es) => {
      this.visible = es[es.length - 1].isIntersecting;
      this.dirty = true;
    }, { rootMargin: "200px" });
    io.observe(this.host);
    this.cleanup.push(() => {
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
    });
  }
  maxPPC() {
    return Math.min(devicePixelRatio || 1, this.o.quality === "full" ? 2 : 1.5);
  }
  minPPC() {
    return Math.min(this.maxPPC(), 0.8);
  }
  viewSize() {
    return [this.canvas.clientWidth || document.documentElement.clientWidth, this.canvas.clientHeight || document.documentElement.clientHeight];
  }
  resize() {
    const gl = this.gl;
    if (!gl || !this.tex) return;
    const [w, h] = this.viewSize();
    this.canvas.width = Math.max(2, Math.round(w * this.ppc));
    this.canvas.height = Math.max(2, Math.round(h * this.ppc));
    const dpr = devicePixelRatio || 1;
    this.bgW = Math.max(2, Math.round(w * Math.min(dpr, 1.5) * 0.6));
    this.bgH = Math.max(2, Math.round(h * Math.min(dpr, 1.5) * 0.6));
    gl.bindTexture(gl.TEXTURE_2D, this.tex.beach);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.bgW, this.bgH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.beach, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bgDirty = true;
    this.dirty = true;
  }
  // ───────────────────────── relief ─────────────────────────
  scheduleRelief(delay = 110) {
    clearTimeout(this.reliefTimer);
    this.reliefTimer = window.setTimeout(() => this.runRelief(), delay);
  }
  runRelief() {
    if (this.busy) {
      this.pending = true;
      return;
    }
    let req;
    try {
      req = buildReliefRequest(this.slab, this.o, this.maxPPC());
    } catch (e) {
      this.err("Relief measure: " + e.message);
      return;
    }
    if (!req) return;
    const id = ++this.jobId, t0 = performance.now();
    if (this.worker) {
      this.busy = true;
      this.jobRect = req.rect;
      this.jobT0 = t0;
      this.worker.postMessage({ id, input: req.input }, [req.input.cutA.buffer, req.input.printA.buffer]);
    } else {
      try {
        this.applyRelief(computeRelief(req.input), req.rect, t0);
      } catch (e) {
        this.err("Relief build: " + e.message);
      }
    }
  }
  applyRelief(out, rect, t0) {
    this.relief = out;
    this.reliefRect = rect;
    this.zBot = -(out.deepest + 2);
    this.uploadRelief(out);
    this.reliefMs = Math.round(performance.now() - t0);
    this.calmUntil = performance.now() + 1500;
    this.dirty = true;
  }
  uploadRelief(out) {
    const gl = this.gl;
    if (!gl || !this.tex) return;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.hf);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, out.tw, out.th, 0, gl.RGBA, gl.FLOAT, out.hf);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.mat);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, out.tw, out.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, out.mat);
  }
  // ───────────────────────── frame loop ─────────────────────────
  effectiveView() {
    return this.reduced && this.o.respectReducedMotion ? "still" : this.o.view;
  }
  targetTilt(t, r) {
    const [rx0, ry0] = this.o.restTilt, [mx, my] = this.o.maxTilt;
    const view = this.effectiveView();
    if (view === "sway") return { rx: rx0 - 3 + 6 * Math.sin(t * 52e-5), ry: ry0 + 10 + 15 * Math.sin(t * 31e-5) };
    if (view === "pointer") {
      if (this.orient && performance.now() - this.orient.at < 1500) return { rx: this.orient.ny * mx, ry: -this.orient.nx * my };
      if (this.pointer.active) {
        const nx = clamp2((this.pointer.x - (r.left + r.width / 2)) / (r.width * 0.55), -1.25, 1.25);
        const ny = clamp2((this.pointer.y - (r.top + r.height / 2)) / (r.height * 0.75), -1.25, 1.25);
        return { rx: ny * mx, ry: -nx * my };
      }
    }
    return { rx: rx0, ry: ry0 };
  }
  draw(t, r) {
    const gl = this.gl, P = this.progs, T = this.tex;
    const [VW, VH] = this.viewSize();
    const o = this.o;
    if (this.mode === "overlay" && (!this.visible || r.bottom < -200 || r.top > VH + 200)) {
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.parked = true;
      return;
    }
    this.parked = false;
    let bgTex = T.beach;
    let bgMap = [0, 0, VW, VH];
    const src = this.bgSource;
    const bgDirty = this.bgDirty;
    this.bgDirty = false;
    if (src === "beach") {
      if (bgDirty || !this.bgPaused) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.bgW, this.bgH);
        gl.useProgram(P.beach.p);
        gl.uniform2f(P.beach.u.uRes, this.bgW, this.bgH);
        gl.uniform1f(P.beach.u.uTime, 8 + t / 1e3);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, T.beach);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
    } else {
      const isVideo = src instanceof HTMLVideoElement;
      const mw = isVideo ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : src.width;
      const mh = isVideo ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : src.height;
      const ready = isVideo ? src.readyState >= 2 : src instanceof HTMLImageElement ? src.complete && mw > 0 : mw > 0;
      if (ready && (bgDirty || isVideo || src instanceof HTMLCanvasElement)) {
        gl.bindTexture(gl.TEXTURE_2D, T.media);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          gl.generateMipmap(gl.TEXTURE_2D);
          this.mediaReady = true;
        } catch (e) {
          this.bgSource = "beach";
          this.bgDirty = true;
          this.dirty = true;
          this.err('Background cannot be used as a texture (cross-origin media needs CORS + crossorigin="anonymous"; files opened from disk are cross-origin too): ' + e.message);
        }
      }
      if (this.mediaReady && mw && mh) {
        let box = { left: 0, top: 0, width: VW, height: VH };
        if (this.bgFit === "element" && src.isConnected) {
          const b = src.getBoundingClientRect();
          if (b.width > 2 && b.height > 2) box = b;
        }
        const s = Math.max(box.width / mw, box.height / mh), dw = mw * s, dh = mh * s;
        bgTex = T.media;
        bgMap = [box.left + (box.width - dw) / 2, box.top + (box.height - dh) / 2, dw, dh];
      }
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    const pr = this.canvas.width / VW;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    if (this.mode === "full") {
      gl.useProgram(P.copy.p);
      gl.uniform1i(P.copy.u.uBg, 0);
      gl.uniform4f(P.copy.u.uBgMap, ...bgMap);
      gl.uniform2f(P.copy.u.uCanvasPx, this.canvas.width, this.canvas.height);
      gl.uniform1f(P.copy.u.uPr, pr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (!this.visible || r.bottom < -200 || r.top > VH + 200) return;
    const az = o.sunAzimuth * Math.PI / 180, el = clamp2(o.sunElevation, 5, 89) * Math.PI / 180;
    const L = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const shX = -L[0] / Math.max(L[2], 0.25) * 36 - this.tilt.ry * 1.6;
    const shY = -L[1] / Math.max(L[2], 0.25) * 36 + this.tilt.rx * 1.6;
    const W = this.slab.offsetWidth, H = this.slab.offsetHeight;
    const margin = o.thickness + 110 + Math.max(Math.abs(shX), Math.abs(shY)) + 0.12 * Math.max(W, H);
    const sx0 = clamp2(r.left - margin, 0, VW), sy0 = clamp2(r.top - margin, 0, VH);
    const sx1 = clamp2(r.right + margin, 0, VW), sy1 = clamp2(r.bottom + margin, 0, VH);
    if (sx1 <= sx0 || sy1 <= sy0) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(sx0 * pr), Math.floor((VH - sy1) * pr), Math.ceil((sx1 - sx0) * pr), Math.ceil((sy1 - sy0) * pr));
    const S = P.slab, u = S.u;
    gl.useProgram(S.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.uniform1i(u.uBg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, T.hf);
    gl.uniform1i(u.uHF, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, T.mat);
    gl.uniform1i(u.uMat, 2);
    gl.activeTexture(gl.TEXTURE0);
    const main = MAIN_TINT[o.mainColor];
    const Tk = o.thickness;
    gl.uniform2f(u.uCanvasPx, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uPr, pr);
    gl.uniform2f(u.uCenter, r.left + r.width / 2, r.top + r.height / 2);
    gl.uniform2f(u.uHalf, W / 2, H / 2);
    gl.uniform4f(u.uHFRect, ...this.reliefRect);
    gl.uniform4f(u.uBgMap, ...bgMap);
    gl.uniformMatrix3fv(u.uR, false, rotMat(this.tilt.rx, this.tilt.ry));
    gl.uniform3f(u.uLight, ...L);
    gl.uniform3f(u.uAbsorb, ...ABSORB[o.glass]);
    gl.uniform3f(u.uMainA, ...main[0]);
    gl.uniform3f(u.uMainB, ...main[1]);
    gl.uniform1f(u.uMainOn, main[2]);
    gl.uniform1f(u.uBtn2Frost, o.secondary === "frost" ? 1 : 0);
    gl.uniform2f(u.uBtnScale, this.btn[1].s, this.btn[2].s);
    gl.uniform2f(u.uShadow, shX, shY);
    gl.uniform1f(u.uT, Tk);
    gl.uniform1f(u.uRe, Math.max(0.5, Math.min(o.edgeRadius, Tk / 2 - 0.5, o.cornerRadius - 1)));
    gl.uniform1f(u.uRc, o.cornerRadius);
    gl.uniform1f(u.uCam, o.camera);
    gl.uniform1f(u.uZTop, o.buttonHeight * 1.3 + 1.5);
    gl.uniform1f(u.uZBot, Math.max(this.zBot, -(Tk - 2)));
    gl.uniform1f(u.uCutMatte, o.finish);
    gl.uniform1f(u.uFrost, o.frost);
    gl.uniform1f(u.uBgDist, 240);
    gl.uniform1f(u.uIor, o.ior);
    gl.uniform1f(u.uAA, o.antialias ? 1 : 0);
    gl.uniform1f(u.uSky, o.reflections === "sky" ? 1 : 0);
    gl.uniform1f(u.uDisp, o.dispersion * 0.05);
    gl.uniform1f(u.uCaustic, o.caustics);
    gl.uniform1f(u.uBubbles, o.bubbles);
    gl.uniform1f(u.uFill, o.fill === "gold" ? 1 : o.fill === "white" ? 2 : 0);
    gl.uniform1f(u.uOverlay, this.mode === "overlay" ? 1 : 0);
    gl.uniform1f(u.uTime, t / 1e3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }
};
export {
  DEFAULTS,
  GlassSlab,
  LETTER_STYLES,
  RELIEF_KEYS,
  SLAB_PRESETS,
  computeRelief
};
