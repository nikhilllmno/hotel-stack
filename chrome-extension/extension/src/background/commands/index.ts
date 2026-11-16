import type { ActArgs, CommandArgs } from "../../shared/protocol";
import { act } from "./act";
import { navigate } from "./navigate";
import { screenshot } from "./screenshot";
import { snapshot } from "./snapshot";
import { tabs, useTab } from "./tabs";
import type { Handlers } from "./types";
import { wait } from "./wait";

/** One executor per bridge command. Arguments arrive untyped from the bridge; each executor checks what it needs. */
export const handlers: Handlers = {
  tabs: () => tabs(),
  use_tab: (args, _approved, isCurrent) => useTab(args as CommandArgs["use_tab"], isCurrent),
  navigate: (args, _approved, isCurrent) => navigate(args as CommandArgs["navigate"], isCurrent),
  snapshot: (args) => snapshot(args as CommandArgs["snapshot"]),
  screenshot: () => screenshot(),
  act: (args, _approved, isCurrent) => act(args as ActArgs, false, isCurrent),
  act_with_approval: (args, approved, isCurrent) => act(args as ActArgs, approved, isCurrent),
  wait: (args) => wait(args as CommandArgs["wait"]),
};
