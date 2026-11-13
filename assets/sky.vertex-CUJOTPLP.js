import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./logDepthDeclaration-FIwYr9tC.js";import{t as n}from"./clipPlaneVertexDeclaration-_B10-M6A.js";import{t as r}from"./fogVertexDeclaration-CiHbVcSR.js";import{t as i}from"./clipPlaneVertex-BDcbHYFd.js";import{t as a}from"./logDepthVertex-DSD5XdGw.js";import{t as o}from"./fogVertex-D0bmc4KF.js";var s=`skyVertexShader`,c=`attribute position: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
uniform world: mat4x4f;uniform view: mat4x4f;uniform viewProjection: mat4x4f;
#ifdef POINTSIZE
uniform pointSize: f32;
#endif
varying vPositionW: vec3f;
#ifdef VERTEXCOLOR
varying vColor: vec4f;
#endif
#include<logDepthDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input : VertexInputs)->FragmentInputs {
#define CUSTOM_VERTEX_MAIN_BEGIN
vertexOutputs.position=uniforms.viewProjection*uniforms.world* vec4f(vertexInputs.position,1.0);var worldPos: vec4f=uniforms.world* vec4f(vertexInputs.position,1.0);vertexOutputs.vPositionW= worldPos.xyz;
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#ifdef VERTEXCOLOR
vertexOutputs.vColor=vertexInputs.color;
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[s]||(e.ShadersStoreWGSL[s]=c);var l=[t,n,r,i,a,o];for(let t of l)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var u={name:s,shader:c};export{u as skyVertexShaderWGSL};