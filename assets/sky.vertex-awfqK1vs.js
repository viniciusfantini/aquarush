import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./logDepthDeclaration-DcRZd9JE.js";import{t as n}from"./clipPlaneVertexDeclaration-lbEIdyxE.js";import{t as r}from"./fogVertexDeclaration-Bb9kDbrL.js";import{t as i}from"./clipPlaneVertex-DPSs14UF.js";import{t as a}from"./logDepthVertex-D5IUM6qd.js";import{t as o}from"./fogVertex-B90wzaBe.js";var s=`skyVertexShader`,c=`precision highp float;attribute vec3 position;
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
uniform mat4 world;uniform mat4 view;uniform mat4 viewProjection;
#ifdef POINTSIZE
uniform float pointSize;
#endif
varying vec3 vPositionW;
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
#include<logDepthDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
gl_Position=viewProjection*world*vec4(position,1.0);vec4 worldPos=world*vec4(position,1.0);vPositionW=vec3(worldPos);
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#ifdef VERTEXCOLOR
vColor=color;
#endif
#if defined(POINTSIZE) && !defined(WEBGPU)
gl_PointSize=pointSize;
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[s]||(e.ShadersStore[s]=c);var l=[t,n,r,i,a,o];for(let t of l)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var u={name:s,shader:c};export{u as skyVertexShader};