import * as THREE from "three";

export const YSongDepthOfFieldShader = {
	name: "YSongDepthOfFieldShader",
	defines: {},
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		tDepth: { value: null as THREE.Texture | null },
		cameraNear: { value: 0.1 },
		cameraFar: { value: 250.0 },
		focusDistance: { value: 7.4 },
		focusRange: { value: 1.5 },
		dofBalance: { value: 0.0 },
		maxBlur: { value: 10.0 },
		bokehSize: { value: 1.0 },
		bokehBlades: { value: 8.0 },
		bokehRotation: { value: 0.0 },
		bokehThreshold: { value: 1.1 },
		bokehGain: { value: 0.35 },
		bokehAnamorphic: { value: 1.0 },
		resolution: { value: new THREE.Vector2(1920, 1080) },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: /* glsl */`
		#include <packing>
		uniform sampler2D tDiffuse;
		uniform sampler2D tDepth;
		uniform float cameraNear;
		uniform float cameraFar;
		uniform float focusDistance;
		uniform float focusRange;
		uniform float dofBalance;
		uniform float maxBlur;
		uniform float bokehSize;
		uniform float bokehBlades;
		uniform float bokehRotation;
		uniform float bokehThreshold;
		uniform float bokehGain;
		uniform float bokehAnamorphic;
		uniform vec2 resolution;
		varying vec2 vUv;

		float viewDistanceFromDepth(float depth) {
			float viewZ = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
			return max(0.0, -viewZ);
		}

		float blurFactorForDepth(float depth) {
			float distanceToCamera = viewDistanceFromDepth(depth);
			float range = max(0.02, focusRange);
			float nearEdge = max(0.0, focusDistance - range);
			float farEdge = focusDistance + range;
			float nearBlur = clamp((nearEdge - distanceToCamera) / range, 0.0, 1.0);
			float farBlur = clamp((distanceToCamera - farEdge) / range, 0.0, 1.0);
			// The signed balance is intentionally user-facing: 0 = off,
			// negative = foreground blur / background focus, positive = background blur / foreground focus.
			float side = dofBalance < 0.0 ? nearBlur : farBlur;
			return side * abs(dofBalance);
		}

		float polygonRadius(float angle, float blades) {
			float count = clamp(floor(blades + 0.5), 3.0, 12.0);
			float sector = 6.28318530718 / count;
			float local = mod(angle + sector * 0.5, sector) - sector * 0.5;
			return cos(sector * 0.5) / max(0.05, cos(local));
		}

		vec3 boostedSample(vec3 color) {
			float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
			float highlight = max(0.0, luma - bokehThreshold);
			return color * (1.0 + highlight * bokehGain);
		}

		void main() {
			vec4 original = texture2D(tDiffuse, vUv);
			if (abs(dofBalance) < 0.0005 || maxBlur <= 0.001) {
				gl_FragColor = original;
				return;
			}
			float depth = texture2D(tDepth, vUv).x;
			float factor = blurFactorForDepth(depth);
			if (factor < 0.002) {
				gl_FragColor = original;
				return;
			}

			vec2 texel = 1.0 / max(resolution, vec2(1.0));
			float radiusPx = maxBlur * factor * max(0.1, bokehSize);
			vec3 sum = boostedSample(original.rgb) * 1.6;
			float weight = 1.6;
			// Fixed sample count keeps this predictable on older GPUs. The blade count
			// changes the aperture footprint rather than shader loop complexity.
			for (int i = 0; i < 16; i++) {
				float fi = float(i);
				float angle = fi * 2.39996322973 + bokehRotation;
				float ring = 0.35 + 0.65 * (fi / 15.0);
				float shape = polygonRadius(angle, bokehBlades);
				vec2 dir = vec2(cos(angle), sin(angle));
				dir.x *= bokehAnamorphic;
				vec2 offset = dir * texel * radiusPx * ring * shape;
				vec3 sampleColor = texture2D(tDiffuse, clamp(vUv + offset, vec2(0.0), vec2(1.0))).rgb;
				sum += boostedSample(sampleColor);
				weight += 1.0;
			}
			gl_FragColor = vec4(sum / weight, original.a);
		}
	`,
};

export const YSongStudioPostShader = {
	name: "YSongStudioPostShader",
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		resolution: { value: new THREE.Vector2(1920, 1080) },
		brightness: { value: 1.0 },
		contrast: { value: 1.0 },
		saturation: { value: 1.0 },
		temperature: { value: 0.0 },
		tint: { value: 0.0 },
		lift: { value: 0.0 },
		gammaValue: { value: 1.0 },
		gain: { value: 1.0 },
		chromaticAberration: { value: 0.0 },
		lensDistortion: { value: 0.0 },
		lensZoom: { value: 1.0 },
		halation: { value: 0.0 },
		filmGrain: { value: 0.0 },
		vignette: { value: 0.0 },
		vignetteSoftness: { value: 0.45 },
		sharpen: { value: 0.0 },
		heatHaze: { value: 0.0 },
		heatHazeSpeed: { value: 0.8 },
		time: { value: 0.0 },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse;
		uniform vec2 resolution;
		uniform float brightness;
		uniform float contrast;
		uniform float saturation;
		uniform float temperature;
		uniform float tint;
		uniform float lift;
		uniform float gammaValue;
		uniform float gain;
		uniform float chromaticAberration;
		uniform float lensDistortion;
		uniform float lensZoom;
		uniform float halation;
		uniform float filmGrain;
		uniform float vignette;
		uniform float vignetteSoftness;
		uniform float sharpen;
		uniform float heatHaze;
		uniform float heatHazeSpeed;
		uniform float time;
		varying vec2 vUv;

		float hash(vec2 p) {
			p = fract(p * vec2(123.34, 456.21));
			p += dot(p, p + 45.32);
			return fract(p.x * p.y);
		}

		void main() {
			vec2 texel = 1.0 / max(resolution, vec2(1.0));
			vec2 fromCenter = vUv - 0.5;
			float r2 = dot(fromCenter, fromCenter);
			vec2 sampleUv = 0.5 + (fromCenter * (1.0 + lensDistortion * r2 * 1.35)) / max(0.5, lensZoom);
			sampleUv = clamp(sampleUv, vec2(0.001), vec2(0.999));
			if (heatHaze > 0.0001) {
				float t = time * max(0.0, heatHazeSpeed);
				float bandA = sin(vUv.y * 78.0 + t * 3.7 + sin(vUv.x * 21.0 - t));
				float bandB = cos(vUv.y * 41.0 - t * 2.3 + cos(vUv.x * 33.0 + t * 0.7));
				vec2 distortion = vec2((bandA + bandB * 0.55) * 0.0018, bandB * 0.00065) * heatHaze;
				sampleUv = clamp(vUv + distortion, vec2(0.001), vec2(0.999));
			}
			vec2 chromaOffset = fromCenter * chromaticAberration * 0.012;
			float r = texture2D(tDiffuse, clamp(sampleUv + chromaOffset, vec2(0.0), vec2(1.0))).r;
			float g = texture2D(tDiffuse, sampleUv).g;
			float b = texture2D(tDiffuse, clamp(sampleUv - chromaOffset, vec2(0.0), vec2(1.0))).b;
			vec4 center = texture2D(tDiffuse, sampleUv);
			vec3 color = vec3(r, g, b);

			if (sharpen > 0.0001) {
				vec3 n = texture2D(tDiffuse, sampleUv + vec2(0.0, texel.y)).rgb;
				vec3 s = texture2D(tDiffuse, sampleUv - vec2(0.0, texel.y)).rgb;
				vec3 e = texture2D(tDiffuse, sampleUv + vec2(texel.x, 0.0)).rgb;
				vec3 w = texture2D(tDiffuse, sampleUv - vec2(texel.x, 0.0)).rgb;
				color += (center.rgb * 4.0 - n - s - e - w) * sharpen * 0.2;
			}

			color *= brightness;
			color = (color - 0.5) * contrast + 0.5;
			float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
			color = mix(vec3(luma), color, saturation);
			// Film-style white balance controls. Temperature moves blue<->amber, tint green<->magenta.
			color += vec3(temperature * 0.12 + tint * 0.035, -tint * 0.075, -temperature * 0.12 + tint * 0.035);
			color = max(vec3(0.0), color + vec3(lift));
			color = pow(max(vec3(0.0), color), vec3(1.0 / max(0.1, gammaValue))) * gain;
			if (halation > 0.0001) {
				vec3 h = vec3(0.0);
				h += texture2D(tDiffuse, clamp(sampleUv + vec2(texel.x*5.0,0.0),vec2(0.0),vec2(1.0))).rgb;
				h += texture2D(tDiffuse, clamp(sampleUv - vec2(texel.x*5.0,0.0),vec2(0.0),vec2(1.0))).rgb;
				h += texture2D(tDiffuse, clamp(sampleUv + vec2(0.0,texel.y*5.0),vec2(0.0),vec2(1.0))).rgb;
				h += texture2D(tDiffuse, clamp(sampleUv - vec2(0.0,texel.y*5.0),vec2(0.0),vec2(1.0))).rgb;
				h *= 0.25;
				float hot = smoothstep(0.62, 1.35, dot(h, vec3(0.2126,0.7152,0.0722)));
				color += h * vec3(1.0,0.34,0.12) * hot * halation * 0.24;
			}

			float edge = length(fromCenter * vec2(1.0, 0.78));
			float vig = smoothstep(max(0.05, vignetteSoftness), 0.82, edge);
			color *= 1.0 - vig * vignette * 0.82;

			float grain = hash(gl_FragCoord.xy + vec2(time * 61.7, time * 17.3)) - 0.5;
			color += grain * filmGrain * 0.11;
			gl_FragColor = vec4(max(vec3(0.0), color), center.a);
		}
	`,
};


export const YSongLightShaftShader = {
	name: "YSongLightShaftShader",
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		lightPosition: { value: new THREE.Vector2(0.5, 0.5) },
		lightColor: { value: new THREE.Color(0xffffff) },
		intensity: { value: 0.0 },
		decay: { value: 0.94 },
		density: { value: 0.88 },
		weight: { value: 0.22 },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
	`,
	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse;
		uniform vec2 lightPosition;
		uniform vec3 lightColor;
		uniform float intensity;
		uniform float decay;
		uniform float density;
		uniform float weight;
		varying vec2 vUv;
		void main(){
			vec4 base=texture2D(tDiffuse,vUv);
			if(intensity<=0.0001){ gl_FragColor=base; return; }
			vec2 delta=(vUv-lightPosition)*(density/28.0);
			vec2 uv=vUv;
			float illumination=1.0;
			vec3 shafts=vec3(0.0);
			for(int i=0;i<28;i++){
				uv-=delta;
				vec3 sampleColor=texture2D(tDiffuse,clamp(uv,vec2(0.0),vec2(1.0))).rgb;
				float lum=dot(sampleColor,vec3(0.2126,0.7152,0.0722));
				float source=smoothstep(0.58,1.35,lum);
				shafts += sampleColor * source * illumination * weight;
				illumination *= decay;
			}
			gl_FragColor=vec4(base.rgb + shafts*lightColor*intensity,base.a);
		}
	`,
};
