console.log("DeepTutor Sync loading...")
var __mnRuntimeModules = globalThis.__mnRuntimeModules
if (!__mnRuntimeModules) {
  __mnRuntimeModules = {}
  globalThis.__mnRuntimeModules = __mnRuntimeModules
}
if (!__mnRuntimeModules.runtime) {
  JSB.require("runtime")
  __mnRuntimeModules.runtime = true
}
if (!__mnRuntimeModules.mnutils) {
  JSB.require("mnutils")
  __mnRuntimeModules.mnutils = true
}
if (!__mnRuntimeModules.mnnote) {
  JSB.require("mnnote")
  __mnRuntimeModules.mnnote = true
}
if (!__mnRuntimeModules.addon) {
  JSB.require("addon")
  __mnRuntimeModules.addon = true
}
JSB.newAddon(__dirname)
