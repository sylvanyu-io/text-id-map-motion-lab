(() => {
  "use strict";

  const TEXTURE_WIDTH = 1600;
  const TEXTURE_HEIGHT = 900;
  const TIMELINE_DURATION = 5.6;
  const DEFAULTS = Object.freeze({
    text: "实时动效引擎",
    intensity: 88,
    speed: 1,
    delay: 0.68,
  });

  const ui = {
    canvas: document.querySelector("#glCanvas"),
    idPreview: document.querySelector("#idPreview"),
    webglError: document.querySelector("#webglError"),
    textInput: document.querySelector("#textInput"),
    intensityInput: document.querySelector("#intensityInput"),
    intensityValue: document.querySelector("#intensityValue"),
    speedInput: document.querySelector("#speedInput"),
    speedValue: document.querySelector("#speedValue"),
    delayInput: document.querySelector("#delayInput"),
    delayValue: document.querySelector("#delayValue"),
    timelineInput: document.querySelector("#timelineInput"),
    timeValue: document.querySelector("#timeValue"),
    playButton: document.querySelector("#playButton"),
    resetButton: document.querySelector("#resetButton"),
    characterLegend: document.querySelector("#characterLegend"),
  };

  const state = {
    ...DEFAULTS,
    time: 0,
    playing: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    previousTimestamp: 0,
    glyphs: [],
  };

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = TEXTURE_WIDTH;
  sourceCanvas.height = TEXTURE_HEIGHT;
  const sourceContext = sourceCanvas.getContext("2d", { alpha: true });

  const idCanvas = document.createElement("canvas");
  idCanvas.width = TEXTURE_WIDTH;
  idCanvas.height = TEXTURE_HEIGHT;
  const idContext = idCanvas.getContext("2d", { alpha: true });

  const gl = ui.canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    ui.webglError.hidden = false;
    ui.webglError.textContent = "当前浏览器无法创建 WebGL 2 上下文。";
    return;
  }

  const vertexShaderSource = `#version 300 es
    layout(location = 0) in vec2 aPosition;
    out vec2 vUv;

    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    layout(location = 0) out vec4 fragColor;
    uniform sampler2D uPackedTexture;
    uniform sampler2D uBoundsTexture;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uSpeed;
    uniform float uDelay;

    const vec2 TEXTURE_SIZE = vec2(1600.0, 900.0);
    const float CYCLE = 5.6;
    const vec3 STAGE = vec3(0.0667, 0.0667, 0.0588);
    const vec3 PAPER = vec3(0.9529, 0.9373, 0.8980);
    const vec3 SIGNAL = vec3(0.9333, 0.3020, 0.1765);
    const vec3 ICE = vec3(0.2157, 0.8784, 0.9216);

    float hash21(vec2 value) {
      value = fract(value * vec2(123.34, 456.21));
      value += dot(value, value + 45.32);
      return fract(value.x * value.y);
    }

    vec2 hash22(vec2 value) {
      vec2 dots = vec2(
        dot(value, vec2(127.1, 311.7)),
        dot(value, vec2(269.5, 183.3))
      );
      return fract(sin(dots) * 43758.5453);
    }

    float inTexture(vec2 uv) {
      vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
      return inside.x * inside.y;
    }

    float idMatch(float sampledId, float expectedId) {
      return 1.0 - step(0.0019, abs(sampledId - expectedId));
    }

    float glyphTap(vec2 uv, float expectedId) {
      vec4 sampled = texture(uPackedTexture, uv);
      return sampled.r * idMatch(sampled.g, expectedId) * inTexture(uv);
    }

    float glyphAlpha(vec2 uv, float expectedId) {
      vec2 position = uv * TEXTURE_SIZE - 0.5;
      vec2 base = floor(position);
      vec2 blend = fract(position);
      vec2 uv00 = (base + vec2(0.5)) / TEXTURE_SIZE;
      vec2 texel = 1.0 / TEXTURE_SIZE;
      float a00 = glyphTap(uv00, expectedId);
      float a10 = glyphTap(uv00 + vec2(texel.x, 0.0), expectedId);
      float a01 = glyphTap(uv00 + vec2(0.0, texel.y), expectedId);
      float a11 = glyphTap(uv00 + texel, expectedId);
      return mix(mix(a00, a10, blend.x), mix(a01, a11, blend.x), blend.y);
    }

    float sameGlyph(vec2 uv, float expectedId) {
      float sampledId = texture(uPackedTexture, uv).g;
      return idMatch(sampledId, expectedId) * inTexture(uv);
    }

    float unpack16(vec2 bytes) {
      vec2 integerBytes = floor(bytes * 255.0 + 0.5);
      return (integerBytes.x * 256.0 + integerBytes.y) / 65535.0;
    }

    vec4 glyphBounds(float id) {
      float idByte = floor(id * 255.0 + 0.5);
      float x = (idByte + 0.5) / 256.0;
      vec4 centerBytes = texture(uBoundsTexture, vec2(x, 0.25));
      vec4 sizeBytes = texture(uBoundsTexture, vec2(x, 0.75));
      return vec4(
        unpack16(centerBytes.rg),
        unpack16(centerBytes.ba),
        sizeBytes.r,
        sizeBytes.g
      );
    }

    vec2 glyphInkSize(float id) {
      float idByte = floor(id * 255.0 + 0.5);
      vec4 sizeBytes = texture(
        uBoundsTexture,
        vec2((idByte + 0.5) / 256.0, 0.75)
      );
      return sizeBytes.ba * TEXTURE_SIZE;
    }

    float window4(float value, float inStart, float inEnd, float outStart, float outEnd) {
      return smoothstep(inStart, inEnd, value) * (1.0 - smoothstep(outStart, outEnd, value));
    }

    float bell(float value, float center, float width) {
      float distanceValue = (value - center) / width;
      return exp(-distanceValue * distanceValue);
    }

    float spring(float progress) {
      float activeWindow = step(0.0, progress) * (1.0 - step(1.0, progress));
      float p = clamp(progress, 0.0, 1.0);
      return sin(p * 15.0) * exp(-4.2 * p) * activeWindow;
    }

    mat2 rotate2d(float angle) {
      float sine = sin(angle);
      float cosine = cos(angle);
      return mat2(cosine, -sine, sine, cosine);
    }

    float edgeAlpha(vec2 uv, float id, float radius) {
      vec2 dx = vec2(radius / TEXTURE_SIZE.x, 0.0);
      vec2 dy = vec2(0.0, radius / TEXTURE_SIZE.y);
      float expanded = max(
        max(glyphAlpha(uv + dx, id), glyphAlpha(uv - dx, id)),
        max(glyphAlpha(uv + dy, id), glyphAlpha(uv - dy, id))
      );
      return max(0.0, expanded - glyphAlpha(uv, id) * 0.72);
    }

    void main() {
      vec2 textureUv = vec2(vUv.x, 1.0 - vUv.y);
      vec4 packedSample = texture(uPackedTexture, textureUv);
      float id = packedSample.g;
      float hasCell = step(0.002, id);
      vec4 bounds = glyphBounds(id);
      vec2 glyphCenter = bounds.rg;
      vec2 cellSizePx = bounds.ba * TEXTURE_SIZE;
      vec2 inkSizePx = glyphInkSize(id);
      vec2 localPx = (textureUv - glyphCenter) * TEXTURE_SIZE;
      float idByte = floor(id * 255.0 + 0.5);
      float rank = clamp((id * 255.0 - 1.0) / 253.0, 0.0, 1.0);
      float time = mod(uTime, CYCLE);
      float intensity = smoothstep(0.0, 1.0, uIntensity);
      float characterDelay = rank * mix(0.04, 0.34, clamp(uDelay / 1.5, 0.0, 1.0));

      float modePhase = 1.0;
      float modeDeconstruct = 1.0;

      float scanline = sin(vUv.y * 900.0 * 3.14159265) * 0.5 + 0.5;
      float gridX = 1.0 - smoothstep(0.0, 0.014, abs(fract(vUv.x * 20.0) - 0.5));
      float gridY = 1.0 - smoothstep(0.0, 0.022, abs(fract(vUv.y * 11.25) - 0.5));
      float vignette = 1.0 - smoothstep(0.18, 0.91, distance(vUv, vec2(0.5)));
      float ambientSweep = exp(-34.0 * abs(vUv.x - fract(time / CYCLE) * 1.16 + 0.08));
      vec3 background = STAGE;
      background += ICE * (gridX + gridY) * 0.010 * vignette;
      background += SIGNAL * ambientSweep * 0.027;
      background *= mix(0.76, 1.0, vignette);
      background += vec3(scanline * 0.009);

      if (hasCell < 0.5) {
        fragColor = vec4(background, 1.0);
        return;
      }

      float introSpread = mix(0.64, 1.32, clamp(uDelay / 1.5, 0.0, 1.0));
      float introStart = 0.12 + rank * introSpread;
      float introProgress = clamp((time - introStart) / 0.46, 0.0, 1.0);
      float introGlitch = window4(
        time,
        introStart,
        introStart + 0.035,
        introStart + 0.34,
        introStart + 0.49
      );
      float flightEase = 1.0 - pow(1.0 - introProgress, 3.0);
      float flightRemain = 1.0 - flightEase;
      float landingRaw = (time - introStart - 0.43) / 0.28;
      float landingProgress = clamp(landingRaw, 0.0, 1.0);
      float landingActive = step(0.0, landingRaw) * (1.0 - step(1.0, landingRaw));
      float landingWobble =
        sin(landingProgress * 6.2831853) *
        pow(1.0 - landingProgress, 2.0) * landingActive;
      float landingImpact =
        sin(landingProgress * 3.14159265) *
        (1.0 - landingProgress) * landingActive;
      float phaseStart = 0.72 + introSpread;
      float phaseBurst = window4(
        time,
        phaseStart,
        phaseStart + 0.08,
        phaseStart + 0.78,
        phaseStart + 0.90
      ) * modePhase;
      float fractureStart = phaseStart + 0.82;
      float fractureEnd = fractureStart + 1.12;
      float assembleStart = fractureStart + 1.05;
      float assembleEnd = assembleStart + 1.16;
      float fractureStage = step(fractureStart, time) * (1.0 - step(fractureEnd, time)) * modeDeconstruct;
      float assembleStage = step(assembleStart, time) * (1.0 - step(assembleEnd, time)) * modeDeconstruct;
      float fractureProgress = clamp((time - fractureStart - characterDelay * 0.22) / 0.92, 0.0, 1.0);
      float assembleProgress = clamp((time - assembleStart - (1.0 - rank) * 0.15) / 0.92, 0.0, 1.0);
      float magneticReturn = max(
        0.0,
        1.0 - assembleProgress + spring(assembleProgress) * 0.32
      );
      float fractureAmount = fractureStage * fractureProgress + assembleStage * magneticReturn;
      float assembleFront = bell(assembleProgress - rank * 0.18, 0.46, 0.10) * assembleStage;
      float eventStrength = clamp(
        introGlitch + abs(landingWobble) * 0.42 + phaseBurst + fractureStage + assembleStage,
        0.0,
        1.0
      );

      float phase = rank * 15.7 + time * 6.2;
      float horizontalSlack = max(1.5, min(18.0, (cellSizePx.x - inkSizePx.x) * 0.42));
      float verticalSlack = max(12.0, min(92.0, (cellSizePx.y - inkSizePx.y) * 0.44));
      float direction = mix(-1.0, 1.0, step(0.5, hash21(vec2(floor(id * 255.0), 7.0))));
      float horizontalMove =
        -horizontalSlack * 0.92 * flightRemain * modePhase * intensity +
        horizontalSlack * 0.11 * landingWobble * modePhase * intensity;
      float verticalMove =
        -verticalSlack * 0.94 * flightRemain * modePhase * intensity -
        verticalSlack * 0.055 * landingImpact * modePhase * intensity;

      vec2 scale = vec2(
        1.0 + landingImpact * 0.055 * intensity,
        1.0 - landingImpact * 0.045 * intensity
      );
      float angle =
        (-0.18 * flightRemain + landingWobble * 0.085) * intensity +
        sin(rank * 19.0 + time * 11.0) * 0.07 * phaseBurst * intensity;
      float shear =
        -0.07 * flightRemain * intensity +
        landingWobble * 0.026 * intensity +
        sin(rank * 13.0 - time * 15.0) * 0.075 * phaseBurst * intensity;

      float sliceHeight = mix(13.0, 5.5, intensity);
      float sliceId = floor((localPx.y + 450.0) / sliceHeight);
      float sliceNoise = hash21(vec2(idByte * 19.0, sliceId));
      float sliceNoiseB = hash21(vec2(sliceId + 37.0, idByte * 7.0));
      float introSliceStart = sliceNoise * 0.58;
      float introSliceVisible = smoothstep(
        introSliceStart,
        introSliceStart + 0.22,
        introProgress
      );
      float introTear =
        (sliceNoise * 2.0 - 1.0) * horizontalSlack *
        mix(0.65, 2.15, sliceNoiseB) * introGlitch * intensity;
      vec2 fragmentSize = vec2(mix(5.2, 2.8, intensity));
      float fragmentActive = clamp(fractureStage + assembleStage, 0.0, 1.0);
      vec2 fragmentOrigin = vec2(800.0, 450.0);
      vec2 fragmentDomain = (localPx + fragmentOrigin) / fragmentSize;
      vec2 fragmentCell = floor(fragmentDomain);
      vec2 fragmentPosition = fract(fragmentDomain);
      float fragmentNoise = hash21(
        fragmentCell + vec2(idByte * 23.0, idByte * 7.0)
      );
      float fragmentNoiseB = hash21(
        fragmentCell.yx + vec2(idByte * 11.0, 71.0)
      );
      vec2 particlePoint = mix(
        vec2(0.20),
        vec2(0.80),
        hash22(fragmentCell + vec2(idByte * 0.37, idByte * 1.91))
      );
      float particleDistance = length(fragmentPosition - particlePoint);
      vec2 randomDirection = normalize(
        hash22(fragmentCell + vec2(idByte * 5.1, 29.7)) * 2.0 - 1.0 + vec2(0.001)
      );
      vec2 particleCenterPx = (fragmentCell + particlePoint) * fragmentSize - fragmentOrigin;
      vec2 outwardDirection = normalize(particleCenterPx + vec2(0.001));
      vec2 fragmentDirection = normalize(
        mix(randomDirection, outwardDirection, 0.25) + vec2(0.001)
      );
      float sliceGate = step(0.36, sliceNoise);
      float phaseImpulse =
        bell(time, phaseStart + 0.12 + rank * 0.07, 0.070) +
        bell(time, phaseStart + 0.42 - rank * 0.05, 0.10) * 0.78 +
        bell(time, phaseStart + 0.69 + rank * 0.03, 0.085) * 0.94;
      float phaseTear =
        (sliceNoise * 2.0 - 1.0) * horizontalSlack * 1.45 *
        phaseBurst * phaseImpulse * intensity * sliceGate;
      float particleTravel = fractureAmount * intensity *
        mix(0.42, 1.22, pow(fragmentNoise, 0.72));
      float fractureTear =
        fragmentDirection.x * horizontalSlack * mix(0.72, 1.62, fragmentNoise) *
        particleTravel;
      float verticalFragment =
        fragmentDirection.y * verticalSlack * mix(0.30, 0.78, fragmentNoiseB) *
        particleTravel;
      float travelDistance = length(vec2(
        fractureTear / max(horizontalSlack * 1.62, 1.0),
        verticalFragment / max(verticalSlack * 0.78, 1.0)
      ));
      float distanceFade = smoothstep(0.04, 0.96, travelDistance);
      float nearRadius = mix(0.38, 0.49, fragmentNoiseB);
      float farRadius = mix(0.08, 0.16, fragmentNoiseB);
      float particleRadius = mix(nearRadius, farRadius, distanceFade);
      float particleSoftness = mix(0.10, 0.055, distanceFade);
      float particleMask = 1.0 - smoothstep(
        particleRadius,
        particleRadius + particleSoftness,
        particleDistance
      );
      float distanceSurvival = 1.0 - smoothstep(0.62, 1.08, travelDistance);
      float particleOpacity = mix(
        1.0,
        mix(0.16, 0.42, fragmentNoiseB) * distanceSurvival,
        pow(distanceFade, 0.78)
      );
      float microTear =
        sin(localPx.y * 0.24 + phase * 2.4) * 2.8 *
        (phaseBurst * phaseImpulse + introGlitch * 0.72) * intensity;

      vec2 transformedPx = localPx - vec2(horizontalMove, verticalMove);
      vec2 fragmentOffsetPx = vec2(fractureTear, verticalFragment);
      transformedPx -= fragmentOffsetPx;
      transformedPx.x -= phaseTear + introTear + microTear;
      transformedPx = rotate2d(-angle) * transformedPx;
      transformedPx /= scale;
      transformedPx.x -= shear * transformedPx.y;
      vec2 sampleUv = glyphCenter + transformedPx / TEXTURE_SIZE;

      vec2 cleanPx = localPx - vec2(horizontalMove, verticalMove);
      cleanPx = rotate2d(-angle) * cleanPx;
      cleanPx /= scale;
      cleanPx.x -= shear * cleanPx.y;
      float phaseBackStrength = clamp(
        phaseBurst * (0.58 + phaseImpulse * 0.82) +
        introGlitch * (0.62 + sliceNoiseB * 0.54),
        0.0,
        1.0
      ) * (1.0 - fragmentActive);
      vec2 phaseOffsetPx = vec2(
        direction * (9.0 + horizontalSlack * 0.82) + sin(rank * 27.0 + time * 8.0) * 5.0,
        sin(rank * 19.0 - time * 7.5) * 10.0
      ) * intensity;
      vec2 phaseBaseUv = glyphCenter + cleanPx / TEXTURE_SIZE;
      float phaseEchoSignal = glyphAlpha(
        phaseBaseUv + phaseOffsetPx / TEXTURE_SIZE,
        id
      ) * hasCell * introSliceVisible;
      float phaseEchoIce = glyphAlpha(
        phaseBaseUv - phaseOffsetPx * 0.82 / TEXTURE_SIZE,
        id
      ) * hasCell * introSliceVisible;

      float fractureSand = smoothstep(0.02, 0.22, fractureProgress) * fractureStage;
      float assembleSand = (1.0 - smoothstep(0.66, 0.98, assembleProgress)) * assembleStage;
      float sandBlend = clamp(fractureSand + assembleSand, 0.0, 1.0);
      float visibility = mix(1.0, particleOpacity, sandBlend);
      float crackMask = mix(1.0, particleMask, sandBlend);
      float fragmentEdge = 1.0 - smoothstep(
        particleRadius + 0.02,
        particleRadius + 0.20,
        particleDistance
      );

      float baseAlpha = glyphAlpha(sampleUv, id) * hasCell;
      float chromaPx = mix(1.5, 8.5, intensity) *
        clamp(phaseBurst * phaseImpulse + introGlitch * 0.92, 0.0, 1.0) *
        (1.0 - fragmentActive);
      vec2 chromaUv = vec2(chromaPx / TEXTURE_SIZE.x, 0.0);
      float redAlpha = glyphAlpha(sampleUv + chromaUv, id) * hasCell;
      float cyanAlpha = glyphAlpha(sampleUv - chromaUv, id) * hasCell;

      vec2 echoVector = vec2(
        horizontalMove * 0.52 + phaseTear * 0.72 + fractureTear * 0.38,
        verticalMove * 0.24 + verticalFragment * 0.46 + sin(phase) * 7.0
      ) / TEXTURE_SIZE;
      float echoA = glyphAlpha(sampleUv + echoVector, id) * hasCell;
      float echoB = glyphAlpha(sampleUv - echoVector * 0.72, id) * hasCell;
      float echoC = glyphAlpha(sampleUv + vec2(-echoVector.x * 1.45, echoVector.y * 0.38), id) * hasCell;

      float outline = edgeAlpha(
        sampleUv,
        id,
        mix(3.0, 14.0, assembleFront)
      ) * hasCell;
      float bandPosition = fract((localPx.y + 450.0) / sliceHeight);
      float bandEdge = 1.0 - smoothstep(0.0, 0.19, min(bandPosition, 1.0 - bandPosition));
      float shardEdge =
        (bandEdge * phaseBurst * phaseImpulse + fragmentEdge * fractureAmount) *
        visibility;
      float flash = clamp(
        introGlitch * 0.12 +
        bell(time, phaseStart + 0.18, 0.045) * modePhase +
        bell(time, fractureStart + 0.03, 0.035) * modeDeconstruct +
        assembleFront * 0.60,
        0.0,
        1.0
      );

      baseAlpha *= visibility * crackMask * introSliceVisible;
      redAlpha *= visibility * crackMask * introSliceVisible;
      cyanAlpha *= visibility * crackMask * introSliceVisible;
      float echoStrength = clamp(
        phaseBurst * phaseImpulse,
        0.0,
        1.0
      ) * (1.0 - fragmentActive);
      echoA *= visibility * echoStrength * introSliceVisible;
      echoB *= visibility * echoStrength * introSliceVisible;
      echoC *= visibility * echoStrength * introSliceVisible;
      outline *= visibility * introSliceVisible;

      vec3 textColor = mix(PAPER, ICE, clamp(assembleFront * 0.48, 0.0, 1.0));
      textColor = mix(textColor, SIGNAL, clamp(flash * 0.72 + fractureAmount * sliceGate * 0.18, 0.0, 1.0));
      textColor *= 0.94 + 0.10 * sin(phase * 0.31) * eventStrength;
      vec3 color = background;
      color += SIGNAL * phaseEchoSignal * phaseBackStrength * 0.68;
      color += ICE * phaseEchoIce * phaseBackStrength * 0.58;
      color += SIGNAL * redAlpha * (0.16 + eventStrength * 0.46);
      color += ICE * cyanAlpha * (0.13 + eventStrength * 0.42);
      color += SIGNAL * echoA * 0.32;
      color += ICE * echoB * 0.28;
      color += mix(SIGNAL, ICE, rank) * echoC * 0.22;
      color += mix(ICE, PAPER, assembleFront) * outline *
        (0.38 + assembleFront * 1.15);
      color += mix(PAPER, ICE, fragmentNoise * 0.30) * shardEdge * baseAlpha * 0.52;
      color = mix(color, textColor, baseAlpha);
      color += PAPER * baseAlpha * flash * 0.48;
      fragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader 编译失败";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram() {
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const nextProgram = gl.createProgram();
    gl.attachShader(nextProgram, vertexShader);
    gl.attachShader(nextProgram, fragmentShader);
    gl.linkProgram(nextProgram);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(nextProgram) || "Program 链接失败";
      gl.deleteProgram(nextProgram);
      throw new Error(message);
    }
    return nextProgram;
  }

  let program;
  try {
    program = createProgram();
  } catch (error) {
    ui.webglError.hidden = false;
    ui.webglError.textContent = `Shader 初始化失败：${error.message}`;
    return;
  }

  const locations = {
    position: gl.getAttribLocation(program, "aPosition"),
    packedTexture: gl.getUniformLocation(program, "uPackedTexture"),
    boundsTexture: gl.getUniformLocation(program, "uBoundsTexture"),
    time: gl.getUniformLocation(program, "uTime"),
    intensity: gl.getUniformLocation(program, "uIntensity"),
    speed: gl.getUniformLocation(program, "uSpeed"),
    delay: gl.getUniformLocation(program, "uDelay"),
  };

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  function createTexture(unit, filter) {
    const texture = gl.createTexture();
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return texture;
  }

  const packedTexture = createTexture(gl.TEXTURE0, gl.NEAREST);
  const boundsTexture = createTexture(gl.TEXTURE1, gl.NEAREST);

  function segmentText(value) {
    if ("Segmenter" in Intl) {
      const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
      return [...segmenter.segment(value)].map((item) => item.segment).slice(0, 28);
    }
    return Array.from(value).slice(0, 28);
  }

  function fitTypography(glyphs) {
    let fontSize = 190;
    const maxWidth = TEXTURE_WIDTH * 0.82;
    while (fontSize > 76) {
      const tracking = Math.max(14, Math.min(30, fontSize * 0.16));
      sourceContext.font = `650 ${fontSize}px "Avenir Next", "PingFang SC", sans-serif`;
      const measuredWidth = glyphs.reduce(
        (total, glyph) => total + sourceContext.measureText(glyph).width + tracking,
        -tracking,
      );
      if (measuredWidth <= maxWidth) {
        return { fontSize, tracking, measuredWidth };
      }
      fontSize -= 6;
    }
    const tracking = Math.max(14, Math.min(30, fontSize * 0.16));
    sourceContext.font = `650 ${fontSize}px "Avenir Next", "PingFang SC", sans-serif`;
    return {
      fontSize,
      tracking,
      measuredWidth: glyphs.reduce(
        (total, glyph) => total + sourceContext.measureText(glyph).width + tracking,
        -tracking,
      ),
    };
  }

  function rebuildTextTextures() {
    const glyphs = segmentText(state.text.trim() || " ");
    const typography = fitTypography(glyphs);
    const baseline = TEXTURE_HEIGHT * 0.57;
    const verticalPadding = Math.max(72, typography.fontSize * 0.55);
    const glyphTop = baseline - typography.fontSize * 1.02;
    const glyphBottom = baseline + typography.fontSize * 0.30;
    const cellTop = Math.max(0, glyphTop - verticalPadding);
    const cellBottom = Math.min(TEXTURE_HEIGHT, glyphBottom + verticalPadding);
    const cellHeight = cellBottom - cellTop;
    let x = (TEXTURE_WIDTH - typography.measuredWidth) * 0.5;

    sourceContext.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    idContext.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    sourceContext.font = `650 ${typography.fontSize}px "Avenir Next", "PingFang SC", sans-serif`;
    sourceContext.textBaseline = "alphabetic";
    sourceContext.fillStyle = "#ffffff";

    state.glyphs = glyphs.map((glyph, index) => {
      const width = sourceContext.measureText(glyph).width;
      const idByte = glyphs.length === 1 ? 127 : Math.round(1 + (index * 253) / (glyphs.length - 1));
      sourceContext.fillText(glyph, x, baseline);
      const record = { glyph, idByte, x, width, cellTop, cellHeight };
      x += width + typography.tracking;
      return record;
    });

    const horizontalPadding = Math.max(6, typography.tracking * 0.5);
    state.glyphs.forEach((record, index) => {
      const previous = state.glyphs[index - 1];
      const next = state.glyphs[index + 1];
      const left = previous
        ? (previous.x + previous.width + record.x) * 0.5
        : record.x - horizontalPadding;
      const right = next
        ? (record.x + record.width + next.x) * 0.5
        : record.x + record.width + horizontalPadding;
      record.cellLeft = Math.max(0, left);
      record.cellRight = Math.min(TEXTURE_WIDTH, right);
      record.centerX = (record.x + record.width * 0.5) / TEXTURE_WIDTH;
      record.centerY = (glyphTop + glyphBottom) * 0.5 / TEXTURE_HEIGHT;
      idContext.fillStyle = `rgb(${record.idByte}, 0, 0)`;
      idContext.fillRect(
        Math.floor(record.cellLeft),
        Math.floor(cellTop),
        Math.ceil(record.cellRight - record.cellLeft),
        Math.ceil(cellHeight),
      );
    });

    const textPixels = new Uint8Array(
      sourceContext.getImageData(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT).data,
    );
    const idPixels = new Uint8Array(
      idContext.getImageData(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT).data,
    );
    const packedPixels = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4);
    for (let index = 0; index < packedPixels.length; index += 4) {
      packedPixels[index] = textPixels[index + 3];
      packedPixels[index + 1] = idPixels[index];
      packedPixels[index + 2] = 0;
      packedPixels[index + 3] = 255;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, packedTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      TEXTURE_WIDTH,
      TEXTURE_HEIGHT,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      packedPixels,
    );

    const boundsPixels = new Uint8Array(256 * 2 * 4);
    const encodeNormalized16 = (value) => {
      const packed = Math.round(Math.max(0, Math.min(1, value)) * 65535);
      return [packed >> 8, packed & 255];
    };
    state.glyphs.forEach(({ idByte, centerX, centerY, cellLeft, cellRight, width }) => {
      const centerOffset = idByte * 4;
      const sizeOffset = (256 + idByte) * 4;
      const centerXBytes = encodeNormalized16(centerX);
      const centerYBytes = encodeNormalized16(centerY);
      boundsPixels[centerOffset] = centerXBytes[0];
      boundsPixels[centerOffset + 1] = centerXBytes[1];
      boundsPixels[centerOffset + 2] = centerYBytes[0];
      boundsPixels[centerOffset + 3] = centerYBytes[1];
      boundsPixels[sizeOffset] = Math.round(((cellRight - cellLeft) / TEXTURE_WIDTH) * 255);
      boundsPixels[sizeOffset + 1] = Math.round((cellHeight / TEXTURE_HEIGHT) * 255);
      boundsPixels[sizeOffset + 2] = Math.round((width / TEXTURE_WIDTH) * 255);
      boundsPixels[sizeOffset + 3] = Math.round(((glyphBottom - glyphTop) / TEXTURE_HEIGHT) * 255);
    });
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, boundsTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      2,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      boundsPixels,
    );

    drawIdPreview();
    renderLegend();
  }

  function drawIdPreview() {
    const context = ui.idPreview.getContext("2d");
    const cropTop = 240;
    const cropHeight = 360;
    context.clearRect(0, 0, ui.idPreview.width, ui.idPreview.height);
    context.fillStyle = "#11110f";
    context.fillRect(0, 0, ui.idPreview.width, ui.idPreview.height);
    const scaleX = ui.idPreview.width / TEXTURE_WIDTH;
    state.glyphs.forEach(({ idByte, cellLeft, cellRight }) => {
      context.fillStyle = `rgb(${idByte}, ${idByte}, ${idByte})`;
      context.fillRect(
        cellLeft * scaleX,
        0,
        Math.max((cellRight - cellLeft) * scaleX, 1),
        ui.idPreview.height,
      );
    });

    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.2;
    context.drawImage(
      sourceCanvas,
      0,
      cropTop,
      TEXTURE_WIDTH,
      cropHeight,
      0,
      0,
      ui.idPreview.width,
      ui.idPreview.height,
    );
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }

  function renderLegend() {
    ui.characterLegend.replaceChildren();
    state.glyphs.forEach(({ glyph, idByte }, index) => {
      const chip = document.createElement("div");
      chip.className = "character-chip";
      const character = document.createElement("strong");
      character.textContent = glyph === " " ? "SPACE" : glyph;
      const metadata = document.createElement("span");
      metadata.textContent = `${String(index).padStart(2, "0")} · R${String(idByte).padStart(3, "0")}`;
      chip.append(character, metadata);
      ui.characterLegend.append(chip);
    });
  }

  function resizeCanvas() {
    const rect = ui.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (ui.canvas.width !== width || ui.canvas.height !== height) {
      ui.canvas.width = width;
      ui.canvas.height = height;
    }
    gl.viewport(0, 0, ui.canvas.width, ui.canvas.height);
  }

  function bindDrawState() {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, packedTexture);
    gl.uniform1i(locations.packedTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, boundsTexture);
    gl.uniform1i(locations.boundsTexture, 1);
    gl.uniform1f(locations.time, state.time);
    gl.uniform1f(locations.intensity, state.intensity / 100);
    gl.uniform1f(locations.speed, state.speed);
    gl.uniform1f(locations.delay, state.delay);
  }

  function draw() {
    resizeCanvas();
    bindDrawState();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function updateTimelineUi() {
    const displayTime = state.time % TIMELINE_DURATION;
    ui.timelineInput.value = displayTime.toFixed(2);
    ui.timeValue.value = `${displayTime.toFixed(2).padStart(5, "0")} s`;
  }

  function animate(timestamp) {
    if (!state.previousTimestamp) {
      state.previousTimestamp = timestamp;
    }
    const delta = Math.min((timestamp - state.previousTimestamp) / 1000, 0.1);
    state.previousTimestamp = timestamp;
    if (state.playing) {
      state.time += delta * state.speed;
      updateTimelineUi();
    }
    draw();
    requestAnimationFrame(animate);
  }

  function setPlaying(nextPlaying) {
    state.playing = nextPlaying;
    ui.playButton.textContent = nextPlaying ? "暂停" : "播放";
    ui.playButton.setAttribute("aria-pressed", String(nextPlaying));
  }

  function syncControls() {
    ui.textInput.value = state.text;
    ui.intensityInput.value = String(state.intensity);
    ui.speedInput.value = String(state.speed);
    ui.delayInput.value = String(state.delay);
    ui.intensityValue.value = `${state.intensity}%`;
    ui.speedValue.value = `${state.speed.toFixed(2)}×`;
    ui.delayValue.value = state.delay.toFixed(2);
    setPlaying(state.playing);
    updateTimelineUi();
  }

  ui.textInput.addEventListener("input", (event) => {
    state.text = event.currentTarget.value;
    rebuildTextTextures();
  });

  ui.intensityInput.addEventListener("input", (event) => {
    state.intensity = Number(event.currentTarget.value);
    ui.intensityValue.value = `${state.intensity}%`;
  });

  ui.speedInput.addEventListener("input", (event) => {
    state.speed = Number(event.currentTarget.value);
    ui.speedValue.value = `${state.speed.toFixed(2)}×`;
  });

  ui.delayInput.addEventListener("input", (event) => {
    state.delay = Number(event.currentTarget.value);
    ui.delayValue.value = state.delay.toFixed(2);
  });

  ui.timelineInput.addEventListener("input", (event) => {
    state.time = Number(event.currentTarget.value);
    state.previousTimestamp = performance.now();
    updateTimelineUi();
    draw();
  });

  ui.playButton.addEventListener("click", () => setPlaying(!state.playing));

  ui.resetButton.addEventListener("click", () => {
    Object.assign(state, DEFAULTS, { time: 0 });
    syncControls();
    rebuildTextTextures();
  });

  window.addEventListener("resize", resizeCanvas, { passive: true });

  syncControls();
  resizeCanvas();
  rebuildTextTextures();
  requestAnimationFrame(animate);
})();
