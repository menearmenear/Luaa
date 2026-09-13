-- ============================================================
--  Lua Playground sandbox environment (Lua 5.3 / Luau-ish)
--  Fakes a small slice of the Roblox runtime in the browser.
-- ============================================================

local real_tostring, real_type = tostring, type
unpack = table.unpack -- Lua 5.3 has no global unpack

-- ---- 1. pretty printer used by print() ----
local function fmt(v, depth, seen)
  if seen == nil then seen = {} end
  local t = real_type(v)
  if t ~= "table" then
    if t == "string" then return '"' .. v .. '"' end
    return real_tostring(v)
  end
  if seen[v] then return "<circular>" end
  seen[v] = true
  if (depth or 0) > 6 then return "<nested...>" end
  local mt = getmetatable(v)
  if mt then
    local ts = mt.__tostring
    if not ts and type(mt.__index) == "table" then ts = mt.__index.__tostring end
    if ts then
      local ok, s = pcall(ts, v)
      if ok and type(s) == "string" then return s end
    end
  end
  local isArray = #v > 0
  if isArray then
    for i = 1, #v do if v[i] == nil then isArray = false break end end
  end
  local parts = {}
  if isArray then
    if #v == 0 then return "{}" end
    for i = 1, #v do parts[i] = fmt(v[i], (depth or 0) + 1, seen) end
    return "{ " .. table.concat(parts, ", ") .. " }"
  end
  local keys = {}
  for k in pairs(v) do table.insert(keys, k) end
  local function cmp(a, b)
    if real_type(a) ~= real_type(b) then return real_type(a) < real_type(b) end
    return real_tostring(a) < real_tostring(b)
  end
  table.sort(keys, cmp)
  for _, k in ipairs(keys) do
    table.insert(parts, "[" .. fmt(k, (depth or 0) + 1, seen) .. "]=" .. fmt(v[k], (depth or 0) + 1, seen))
  end
  return "{ " .. table.concat(parts, ", ") .. " }"
end

function print(...)
  local n = select("#", ...)
  local parts = {}
  for i = 1, n do parts[i] = fmt((select(i, ...))) end
  _iotab(table.concat(parts, "  ") .. "\n")
end

-- ---- 2. Vector3 / Color3 / UDim2 (lightweight) ----
Vector3 = setmetatable({}, { __call = function(_, x, y, z) return Vector3.new(x, y, z) end })
Vector3.__index = Vector3
function Vector3.new(x, y, z) return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, Vector3) end
function Vector3.__add(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
function Vector3.__sub(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
function Vector3.__mul(a, b) return Vector3.new(a.X * b, a.Y * b, a.Z * b) end
function Vector3.__div(a, b) return Vector3.new(a.X / b, a.Y / b, a.Z / b) end
function Vector3.__eq(a, b) return a.X == b.X and a.Y == b.Y and a.Z == b.Z end
function Vector3.__tostring(v) return "Vector3.new(" .. v.X .. ", " .. v.Y .. ", " .. v.Z .. ")" end
function Vector3:Magnitude() return math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z) end
function Vector3:Dot(b) return self.X * b.X + self.Y * b.Y + self.Z * b.Z end
function Vector3:Unit()
  local m = self:Magnitude()
  if m == 0 then return Vector3.new(0, 0, 0) end
  return Vector3.new(self.X / m, self.Y / m, self.Z / m)
end
function Vector3:Lerp(b, a) return self + (b - self) * a end
function Vector3:Cross(b) return Vector3.new(self.Y * b.Z - self.Z * b.Y, self.Z * b.X - self.X * b.Z, self.X * b.Y - self.Y * b.X) end
Vector3.zero = Vector3.new(0, 0, 0)
Vector3.one = Vector3.new(1, 1, 1)

-- CFrame (position + orientation, teaching-grade)
CFrame = setmetatable({}, { __call = function(_, ...) return CFrame.new(...) end })
CFrame.__index = CFrame
function CFrame.new(px, py, pz, r00, r01, r02, r10, r11, r12, r20, r21, r22)
  local cf = setmetatable({}, CFrame)
  cf.X, cf.Y, cf.Z = px or 0, py or 0, pz or 0
  if r00 then
    cf.R = { r00, r01, r02, r10, r11, r12, r20, r21, r22 }
  else
    cf.R = { 1, 0, 0, 0, 1, 0, 0, 0, 1 }
  end
  return cf
end
function CFrame:__tostring()
  return "CFrame.new(" .. math.floor(self.X * 1000) / 1000 .. ", "
    .. math.floor(self.Y * 1000) / 1000 .. ", " .. math.floor(self.Z * 1000) / 1000 .. ")"
end
function CFrame:P() return Vector3.new(self.X, self.Y, self.Z) end
function CFrame:Position() return self:P() end
function CFrame.lookAt(from, to)
  local fwd = (to - from).Unit
  local right = fwd:Dot(Vector3.new(0, 1, 0)) == 1 and Vector3.new(1, 0, 0)
    or Vector3.new(0, 1, 0):Cross(fwd).Unit
  local upv = right:Cross(fwd)
  return CFrame.new(from.X, from.Y, from.Z,
    right.X, upv.X, fwd.X,
    right.Y, upv.Y, fwd.Y,
    right.Z, upv.Z, fwd.Z)
end
function CFrame:RightVector() return Vector3.new(self.R[1], self.R[4], self.R[7]).Unit end
function CFrame:UpVector() return Vector3.new(self.R[2], self.R[5], self.R[8]).Unit end
function CFrame:LookVector() return Vector3.new(self.R[3], self.R[6], self.R[9]).Unit end
function CFrame:Inverse() return CFrame.new(-self.X, -self.Y, -self.Z) end
function CFrame:__mul(v)
  if getmetatable(v) == Vector3 then
    return Vector3.new(self.X + v.X, self.Y + v.Y, self.Z + v.Z)
  end
  if getmetatable(v) == CFrame then
    return CFrame.new(self.X + v.X, self.Y + v.Y, self.Z + v.Z, table.unpack(self.R))
  end
  return self
end
function CFrame:PointToWorldSpace(v) return self * v end
function CFrame:ToObjectSpace(v) return v - self:P() end
function CFrame:Lerp(target, a)
  return CFrame.new(
    self.X + (target.X - self.X) * a,
    self.Y + (target.Y - self.Y) * a,
    self.Z + (target.Z - self.Z) * a)
end

Vector3.Up = Vector3.new(0, 1, 0)
Vector3.Right = Vector3.new(1, 0, 0)
Vector3.LookVector = Vector3.new(0, 0, -1)

Color3 = setmetatable({}, { __call = function(_, r, g, b) return Color3.new(r, g, b) end })
Color3.__index = Color3
function Color3.new(r, g, b) return setmetatable({ R = r, G = g, B = b }, Color3) end
Color3.fromRGB = function(r, g, b) return Color3.new(r / 255, g / 255, b / 255) end
function Color3:__tostring() return "Color3.new(" .. string.format("%d,%d,%d", self.R * 255, self.G * 255, self.B * 255) .. ")" end

UDim2 = {}
UDim2.__index = UDim2
function UDim2.new(xScale, xOffset, yScale, yOffset)
  return setmetatable({ X = { Scale = xScale or 0, Offset = xOffset or 0 }, Y = { Scale = yScale or 0, Offset = yOffset or 0 } }, UDim2)
end
UDim2.fromOffset = function(w, h) return UDim2.new(0, w, 0, h) end
UDim2.fromScale = function(w, h) return UDim2.new(w, 0, h, 0) end
UDim = {}
UDim.__index = UDim
function UDim.new(scale, offset) return setmetatable({ Scale = scale or 0, Offset = offset or 0 }, UDim) end

-- ---- 3. mini event signals ----
Signal = {}
Signal.__index = Signal
function Signal:Connect(fn)
  table.insert(self._handlers, fn)
  local conn = {
    Connected = true,
    fn = fn,
    sig = self,
    Disconnect = function()
      conn.Connected = false
      for i = #self._handlers, 1, -1 do
        if self._handlers[i] == fn then table.remove(self._handlers, i) end
      end
    end,
  }
  if self._last then fn(unpack(self._last)) end
  return conn
end
function Signal:Wait()
  local args = self._last
  if args then
    self._last = nil
    return unpack(args)
  end
  coroutine.yield("__wait_signal")
  args = self._last or {}
  self._last = nil
  return unpack(args)
end
function Signal:Fire(...)
  local args = { ... }
  self._last = args
  for _, fn in ipairs(self._handlers) do
    task.spawn(function()
      fn(unpack(args))
    end)
  end
end
function newSignal()
  return setmetatable({ _handlers = {}, _last = nil }, Signal)
end

-- ---- 4. Instance engine ----
Instance = {}
local constructors = {}

local parentSetter
local rawNew
rawNew = function(class, props)
  local t = {}
  t._class = class
  t._name = class
  t._children = {}
  t._parent = nil
  setmetatable(t, {
    __index = function(self, k)
      local f = Instance[k]
      if f ~= nil then return f end
      if k == "ClassName" then return self._class end
      if k == "Name" then return self._name end
      if k == "Parent" then return self._parent end
      if k == "Children" then return self._children end
      return nil
    end,
    __newindex = function(self, k, v)
      if k == "ClassName" then self._class = v
      elseif k == "Name" then self._name = v
      elseif k == "Children" then self._children = v
      elseif k == "Parent" then parentSetter(self, v)
      else rawset(self, k, v) end
    end,
    __tostring = function(self)
      return self._class .. ' "' .. self._name .. '"'
    end,
  })
  t.Changed = newSignal()
  t.ChildAdded = newSignal()
  t.DescendantAdded = newSignal()
  for k, v in pairs(props or {}) do
    if k == "Name" then t._name = v elseif k == "Parent" then parentSetter(t, v) else rawset(t, k, v) end
  end
  return t
end

parentSetter = function(self, v)
  if self._parent and self._parent ~= v then
    local p = self._parent
    for i, c in ipairs(p._children) do
      if c == self then table.remove(p._children, i) break end
    end
    self._parent = nil
  end
  if v then
    v._children[#v._children + 1] = self
    self._parent = v
    v.ChildAdded:Fire(self)
  end
  return v
end

function Instance:GetChildren()
  local t = {}
  for _, c in ipairs(self._children) do table.insert(t, c) end
  return t
end
function Instance:GetDescendants()
  local out = {}
  local function walk(n)
    for _, c in ipairs(n._children) do
      table.insert(out, c)
      walk(c)
    end
  end
  walk(self)
  return out
end
function Instance:FindFirstChild(name, recursive)
  for _, c in ipairs(self._children) do
    if c._name == name then return c end
  end
  if recursive then
    for _, c in ipairs(self._children) do
      local r = c:FindFirstChild(name, true)
      if r then return r end
    end
  end
  return nil
end
function Instance:FindFirstChildOfClass(cc)
  for _, c in ipairs(self._children) do if c._class == cc then return c end end
  return nil
end
function Instance:WaitForChild(name, timeout)
  local c = self:FindFirstChild(name)
  if c then return c end
  local tries = 0
  repeat
    task.wait(0.1)
    tries = tries + 1
    c = self:FindFirstChild(name)
  until c or (timeout and tries * 0.1 > timeout)
  return c
end
function Instance:Destroy()
  if self._parent then parentSetter(self, nil) end
end
function Instance:IsA(cc) return self._class == cc end
function Instance:IsDescendantOf(a)
  local p = self._parent
  while p do
    if p == a then return true end
    p = p._parent
  end
  return false
end
function Instance:Clone()
  local c = rawNew(self._class, { Name = self._name })
  for _, ch in ipairs(self._children) do
    local gc = ch:Clone()
    gc.Parent = c
  end
  return c
end
function Instance:GetFullName()
  local stopper = self
  local parts = {}
  while stopper do
    parts[#parts + 1] = stopper._name
    stopper = stopper._parent
  end
  return table.concat(parts, ".")
end

-- constructor registry for special classes
constructors.Part = function(props)
  local p = rawNew("Part", props)
  p.Size = Vector3.new(1, 1, 1)
  p.Anchored = (props and props.Anchored) or false
  p.Position = Vector3.new(0, 0, 0)
  p.Material = "Plastic"
  p.Color = Color3.new(1, 1, 1)
  return p
end
constructors.MeshPart = constructors.Part
constructors.Humanoid = function(props)
  local h = rawNew("Humanoid", props)
  h.Health, h.MaxHealth = 100, 100
  h.WalkSpeed = 16
  h.JumpPower = 50
  return h
end
constructors.Frame = function(props)
  local f = rawNew("Frame", props)
  f.BackgroundColor3 = Color3.new(0.08, 0.08, 0.1)
  f.BackgroundTransparency = 0.2
  f.Size = UDim2.new(0, 200, 0, 100)
  f.BorderSizePixel = 0
  return f
end
constructors.TextLabel = function(props)
  local l = rawNew("TextLabel", props)
  l.Text = "Label"
  l.TextColor3 = Color3.new(1, 1, 1)
  l.BackgroundTransparency = 0.7
  l.TextScaled = true
  return l
end
constructors.TextButton = function(props)
  local b = rawNew("TextButton", props)
  b.Text = "Button"
  b.TextColor3 = Color3.new(1, 1, 1)
  b.BackgroundColor3 = Color3.new(0.2, 0.45, 0.9)
  b.Activated = newSignal()
  b.Size = UDim2.new(0, 160, 0, 40)
  return b
end
constructors.ScreenGui = function(props)
  return rawNew("ScreenGui", props)
end
constructors.RemoteEvent = function(props)
  local r = rawNew("RemoteEvent", props)
  r.OnClientEvent = newSignal()
  r.OnServerEvent = newSignal()
  r.FireServer = function(self, ...)
    local parts = {}
    for i = 1, select("#", ...) do parts[i] = tostring(select(i, ...)) end
    _iotab("[remote] " .. self._name .. ":FireServer(" .. table.concat(parts, ", ") .. ")\n")
    -- real Roblox always appends the firing player; so do we
    local who = game and game.Players and game.Players.LocalPlayer
    self.OnServerEvent:Fire(who, ...)
  end
  r.FireClient = function(self, who, ...)
    _iotab("[remote] " .. self._name .. "->" .. tostring(who and who._name or "?") .. "\n")
    self.OnClientEvent:Fire(...)
  end
  r.FireAllClients = function(self, ...)
    _iotab("[remote] " .. self._name .. " broadcast\n")
    self.OnClientEvent:Fire(...)
  end
  return r
end
constructors.BindableEvent = function(props)
  local r = constructors.RemoteEvent(props)
  r._class = "BindableEvent"
  return r
end
constructors.BindableFunction = function(props) return rawNew("BindableFunction", props) end

local ctor
ctor = function(class, props)
  local c = constructors[class]
  if c then return c(props) end
  return rawNew(class, props)
end
Instance.new = ctor

-- ---- 5. task / spawn / wait ----
task = {}
function task.wait(n)
  local t = (n and n > 0) and n or 0
  coroutine.yield(t)
  return t
end
function task.spawn(fn, ...)
  return _spawn(fn, ...)
end
function task.defer(fn, ...) return task.spawn(fn, ...) end
function task.delay(sec, fn, ...) return task.spawn(fn, ...) end
function task.cancel() end
function task.synchronize(fn, ...) return task.spawn(fn, ...) end
function task.desynchronize(fn, ...) return task.spawn(fn, ...) end
wait = task.wait
spawn = task.spawn
delay = task.delay

loadstring = loadstring or load
getgenv = getgenv or function() return _G end
getexecutorname = getexecutorname or function() return "Lua Playground (sandbox)" end
identifyexecutor = identifyexecutor or function() return "lua-playground", "1.0" end
setfpscap = setfpscap or function() end
getfpscap = getfpscap or function() return 60 end

-- ---- executor API shims (harmless, teaching-grade) ----
getrawmetatable = getrawmetatable or function(t) return getmetatable(t) end
getrawget = getrawget or rawget
getrawset = getrawset or rawset
hookmetamethod = hookmetamethod or function(mt, name, fn) return mt and mt[name] or function() end end
hookfunction = hookfunction or function(fn, repl) return fn end
clonefunction = clonefunction or function(fn) return fn end
newcclosure = newcclosure or function(fn) return fn end
iscclosure = iscclosure or function(fn) return false end
checkcaller = checkcaller or function() return true end
printidentity = printidentity or function() _iotab("Identity: 8 (Roblox)\n") end
getnamecallmethod = getnamecallmethod or function() return "" end
setreadonly = setreadonly or function(t, flag) end
isreadonly = isreadonly or function(t) return false end
setclipboard = setclipboard or function(s) _iotab("[clipboard] set\n") end
getgc = getgc or function() return {} end
getreg = getreg or function() return setmetatable({}, { __tostring = function() return "registry (hidden)" end }) end
getupvalues = getupvalues or function(f) return {} end
getconstants = getconstants or function(f) return {} end

-- ---- Luau math conveniences absent from Lua 5.3 ----
math.atan2 = math.atan2 or function(y, x) return math.atan(y, x) end
math.clamp = math.clamp or function(x, a, b) return math.min(math.max(x, a), b) end
math.round = math.round or function(x) return math.floor(x + 0.5) end
math.sign = math.sign or function(x) return x > 0 and 1 or (x < 0 and -1 or 0) end
math.noise = math.noise or function() return 0 end
table.find = table.find or function(t, v)
  for i = 1, #t do if t[i] == v then return i end end
  return nil
end
table.clear = table.clear or function(t) for k in pairs(t) do t[k] = nil end end

-- ---- 6. game, services, workspace ----
local services = {}
local game = rawNew("Game", { Name = "game" })

local function makeService(name)
  local s = rawNew("Service", { Name = name })
  services[name] = s
  return s
end
local function getService(name)
  if not services[name] then makeService(name) end
  return services[name]
end

-- Players
local Players = getService("Players")
local player = rawNew("Player", { Name = "DemoUser", DisplayName = "You", UserId = 588447 })
Players.LocalPlayer = player
player.Character = rawNew("Model", { Name = "Character" })
player.Humanoid = ctor("Humanoid", { Name = "Humanoid" })
player.Humanoid.Parent = player.Character
player.Backpack = rawNew("Model", { Name = "Backpack" })
player.PlayerGui = rawNew("ScreenGui", { Name = "PlayerGui" })
player.CharacterAdded = newSignal()
player.CharacterRemoving = newSignal()
player.CharacterAppearanceLoaded = newSignal()
local function makeMouse()
  local m = rawNew("Mouse", { Name = "Mouse" })
  m.X, m.Y = 0, 0
  m.Hit = CFrame.new(0, 0, 0)
  m.Target = nil
  m.UnitRay = { Origin = Vector3.new(0, 0, 0), Direction = Vector3.new(0, 0, -1) }
  m.Button1Down = newSignal()
  m.Button1Up = newSignal()
  m.Move = newSignal()
  m.KeyDown = newSignal()
  m.KeyUp = newSignal()
  return m
end
rawset(player, "GetMouse", function(self) return makeMouse() end)
rawset(player, "GetPlayerGui", function(self) return self.PlayerGui end)
rawset(player, "GetCharacterAppearanceAsync", function(self) return {} end)
rawset(player, "Kick", function(self, msg)
  _iotab("[player] " .. self._name .. " kicked: " .. tostring(msg) .. "\n")
end)
Players.playerAdded = newSignal()
Players.playerRemoving = newSignal()
Players.GetPlayers = function() return { player } end
Players.GetPlayerFromCharacter = function(self, ch) return player end
Players.GetNameFromUserIdAsync = function(self, id) return "Player" .. tostring(id) end
Players.GetUserIdFromNameAsync = function(self, name) return 1 end

-- Workspace
local Workspace = getService("Workspace")
local base = ctor("Part", { Name = "Baseplate", Anchored = true })
base.Size = Vector3.new(512, 1, 512)
base.Position = Vector3.new(0, 0, 0)
base.Parent = Workspace
Workspace.Gravity = 196.2
Workspace.StreamingEnabled = false
Workspace.Raycast = function() return nil end
Workspace.FindPartOnRay = function() return nil end

-- RunService
local RunService = getService("RunService")
RunService.Heartbeat = newSignal()
RunService.RenderStepped = RunService.Heartbeat
RunService.Stepped = newSignal()
RunService.PreSimulation = newSignal()
RunService.PostSimulation = newSignal()
RunService.BindToRenderStep = function(self, name, priority, fn)
  return RunService.Heartbeat:Connect(fn)
end
RunService.UnbindFromRenderStep = function(self, name) end
RunService.IsClient = function() return true end
RunService.IsStudio = function() return true end
RunService.IsServer = function() return true end
RunService.IsRunning = function() return true end
-- engine drives RunService.Heartbeat while a run has pending coroutines

-- Camera on workspace
local sharedCamera = ctor("Camera", { Name = "Camera" })
sharedCamera.CFrame = CFrame.new(0, 12, -20)
sharedCamera.Focus = CFrame.new(0, 0, 0)
sharedCamera.ViewportSize = Vector3.new(1280, 720, 0)
Workspace.CurrentCamera = sharedCamera

-- ReplicatedStorage
local ReplicatedStorage = getService("ReplicatedStorage")
local remotes = rawNew("Folder", { Name = "Remotes" })
remotes.Parent = ReplicatedStorage
local eventsFolder = rawNew("Folder", { Name = "Events" })
eventsFolder.Parent = ReplicatedStorage

-- HttpService
local HttpService = getService("HttpService")
HttpService.HttpEnabled = true

local jsonEsc = function(c)
  if c == '"' then return '\\"' end
  if c == "\\" then return "\\\\" end
  if c == "\n" then return "\\n" end
  if c == "\t" then return "\\t" end
  if c == "\r" then return "\\r" end
  if string.byte(c) < 32 then return string.format("\\u%04x", string.byte(c)) end
  return c
end
local function jenc(v, seen)
  local t = real_type(v)
  if t == "nil" then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
    return string.format("%.8g", v)
  end
  if t == "string" then return '"' .. v:gsub('[%z\1-\31"\\%c]', jsonEsc) .. '"' end
  if t ~= "table" then return "null" end
  if seen[v] then return "null" end
  seen[v] = true
  local out = {}
  local count = 0
  local max = 0
  for k in pairs(v) do count = count + 1 if real_type(k) == "number" and k > max then max = k end end
  if count > 0 and max == count then
    for i = 1, count do out[i] = jenc(v[i], seen) end
    return "[" .. table.concat(out, ",") .. "]"
  end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b)
    if real_type(a) ~= real_type(b) then return real_type(a) < real_type(b) end
    return real_tostring(a) < real_tostring(b)
  end)
  for i, k in ipairs(keys) do
    out[i] = jenc(k, seen) .. ":" .. jenc(v[k], seen)
  end
  return "{" .. table.concat(out, ",") .. "}"
end
function HttpService:JSONEncode(v) return jenc(v, {}) end
function HttpService:JSONModuleCodec() return {} end
function HttpService:JSONDecode(s) return nil end
function HttpService:GenerateGUID(useCurlyBraces)
  local function h() return string.format("%08x", math.random(0, 0xffffffff)) end
  local g = h() .. "-" .. string.sub(h(), 1, 4) .. "-" .. string.sub(h(), 1, 4) .. "-" .. string.sub(h(), 1, 4) .. "-" .. h()
  return useCurlyBraces and ("{" .. g .. "}") or g
end

-- StarterGui / Debris / TextChatService / TweenService
local StarterGui = getService("StarterGui")
StarterGui.SetCore = function(self, k, v)
  _iotab("[StarterGui] SetCore(" .. tostring(k) .. ")\n")
end
StarterGui.SetCoreGuiEnabled = function() end
local Debris = getService("Debris")
Debris.AddItem = function() end
local TextChatService = getService("TextChatService")
TextChatService.ChatVersion = "TextChatService"
local TweenService = getService("TweenService")
TweenService.Create = function() return { Play = function() end, Cancel = function() end } end
local Lighting = getService("Lighting")
Lighting.Brightness = 1
Lighting.ClockTime = 14

game.GetService = function(self, n) return getService(n) end
game.GetObjects = function(self, s) return {} end
function game:HttpGet(url, noCache)
  _iotab("[sandbox] HttpGet(" .. tostring(url) .. ") blocked\n")
  return "-- fake fetched: " .. tostring(url)
end
function game:HttpGetAsync(url) return game:HttpGet(url) end
function game:HttpPost(url, body) _iotab("[sandbox] HttpPost blocked\n") return "" end
game.Players = Players
game.Workspace = Workspace
game.ReplicatedStorage = ReplicatedStorage
game.HttpService = HttpService
game.Lighting = Lighting
game.FindFirstChild = Instance.FindFirstChild
game.WaitForChild = Instance.WaitForChild
-- dot access for game/services handled by Players/Workspace globals already

-- expose friends
workspace = Workspace

-- ---- 7. SandboxSim: the visual mini-game world ----
-- Lua holds the state, the engine renders it to a canvas next to the
-- output box and sends clicks back here. Like a tiny anime-sim.
SandboxSim = {}
local simWorld = {
  visible = false,
  player = { x = 0, z = 0, angle = 0, color = "#4fc3f7", name = "You", hp = 100, maxhp = 100 },
  mobs = {},
  coins = {},
  gui = {},
}
local simListeners = {}
local simMobSeq = 0

function SandboxSim.show()
  simWorld.visible = true
end
function SandboxSim.hide()
  simWorld.visible = false
end
function SandboxSim.setPlayer(x, z, angle)
  simWorld.player.x = x or 0
  simWorld.player.z = z or 0
  if angle then simWorld.player.angle = angle end
end
function SandboxSim.getPlayer()
  return simWorld.player.x, simWorld.player.z
end
function SandboxSim.setPlayerColor(c) simWorld.player.color = c end
function SandboxSim.setPlayerName(n) simWorld.player.name = n end
function SandboxSim.setHealth(h, mh)
  simWorld.player.hp = h
  if mh then simWorld.player.maxhp = mh end
end
function SandboxSim.addMob(x, z, hp, color, name)
  simMobSeq = simMobSeq + 1
  local m = { id = simMobSeq, x = x or 0, z = z or 0, hp = hp or 10, maxhp = hp or 10, color = color or "#e57373", name = name or "mob" }
  simWorld.mobs[#simWorld.mobs + 1] = m
  return m
end
function SandboxSim.removeMob(i) table.remove(simWorld.mobs, i) end
function SandboxSim.getMobs() return simWorld.mobs end
function SandboxSim.addCoin(x, z)
  simWorld.coins[#simWorld.coins + 1] = { x = x or 0, z = z or 0 }
end
function SandboxSim.removeCoin(i) table.remove(simWorld.coins, i) end
function SandboxSim.getCoins() return simWorld.coins end
function SandboxSim.setGui(id, g)
  if not g then simWorld.gui[id] = nil return end
  g.id = id
  simWorld.gui[id] = g
end
function SandboxSim.removeGui(id) simWorld.gui[id] = nil end
function SandboxSim.clearVisuals()
  simWorld.mobs = {}
  simWorld.coins = {}
  simWorld.gui = {}
end
function SandboxSim.on(evt, fn) simListeners[evt] = fn end
function SandboxSim.off(evt) simListeners[evt] = nil end

-- bridge used by the JS engine (registered below in C via these globals)
function _dispatchEvent(t, a, b)
  local f = simListeners[t]
  if f then return f(a, b) end
end
function _frameJSON()
  return HttpService:JSONEncode(simWorld)
end
function _heartbeatCallback(dt)
  RunService.Heartbeat:Fire(dt or 0.016)
end

-- ---- 8. publish globals ----
_G.game = game
_G.workspace = Workspace
_G.Players = Players
_G.ReplicatedStorage = ReplicatedStorage
_G.RunService = RunService
_G.Lighting = Lighting
_G.HttpService = HttpService
_G.Instance = Instance
_G.newSignal = newSignal
_G.Vector3 = Vector3
_G.Color3 = Color3
_G.CFrame = CFrame
_G.UDim2 = UDim2
_G.UDim = UDim
_G.SandboxSim = SandboxSim
_G.task = task
_G.wait = wait
_G.spawn = spawn
_G.delay = delay
_G.unpack = unpack

-- help text
print("== Lua Playground sandbox ready ==")
print("Themes: print, tables, functions, coroutines, events")
print("Fake Roblox: game, workspace, Players, Instance, Vector3, CFrame, task")
print("Visual sim: SandboxSim.show() renders a playable mini-game below")