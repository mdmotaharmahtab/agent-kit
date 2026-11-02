// Runs before every test file (vitest.config.js, setupFiles).
import { afterAll } from "vitest";

import { removeTempDirs } from "./temp-dirs.js";

afterAll(removeTempDirs);
