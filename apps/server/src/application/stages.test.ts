import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStageStore } from "../../test/fakes/in-memory-stage-store.ts";
import { createStage, deleteStage, listStages, updateStage, type StagesDeps } from "./stages.ts";

describe("stages", () => {
  let store: InMemoryStageStore;
  let deps: StagesDeps;
  const SHOP = 3;

  const seed = async (...names: string[]) => {
    for (const name of names) await createStage(deps, "shop", { name });
    return store.stages.filter((s) => s.projectId === SHOP).map((s) => s.id);
  };

  beforeEach(() => {
    store = new InMemoryStageStore();
    store.projects.push({ id: SHOP, slug: "shop" }, { id: 4, slug: "blog" });
    deps = { store };
  });

  describe("listStages", () => {
    it("lists the project's stages in order", async () => {
      await seed("Backend", "Frontend");
      await createStage(deps, "blog", { name: "Other" });
      expect(await listStages(deps, "Shop")).toEqual({
        status: "ok",
        stages: [
          { id: expect.any(Number), name: "Backend", position: 0 },
          { id: expect.any(Number), name: "Frontend", position: 1 },
        ],
      });
    });

    it.each([["ghost"], ["not a slug"]])("reports %j as not found", async (slug) => {
      expect(await listStages(deps, slug)).toEqual({ status: "project_not_found" });
    });
  });

  describe("createStage", () => {
    it("appends a trimmed stage while the project is locked", async () => {
      await seed("Backend");
      expect(await createStage(deps, "shop", { name: "  Etapa 2 " })).toEqual({
        status: "created",
        stage: { id: expect.any(Number), name: "Etapa 2", position: 1 },
      });
      expect(store.locks).toContain("shop");
    });

    it.each([[null], ["x"], [{}], [{ name: "  " }], [{ name: "x".repeat(51) }], [{ name: 7 }]])(
      "rejects %j as an invalid name",
      async (body) => {
        expect(await createStage(deps, "shop", body)).toEqual({ status: "invalid", field: "name" });
        expect(store.stages).toEqual([]);
      },
    );

    it("refuses a name the project already has, case-insensitively", async () => {
      await seed("Backend");
      expect(await createStage(deps, "shop", { name: "BACKEND" })).toEqual({ status: "stage_taken" });
      expect(store.names(SHOP)).toEqual(["Backend"]);
    });

    it("reports an unknown project", async () => {
      expect(await createStage(deps, "ghost", { name: "Backend" })).toEqual({ status: "project_not_found" });
    });
  });

  describe("updateStage", () => {
    it("renames a stage and the tasks in it", async () => {
      const [backend] = await seed("Backend", "Frontend");
      store.tasks.push(
        { projectId: SHOP, stage: "Backend" },
        { projectId: SHOP, stage: "Frontend" },
        { projectId: 4, stage: "Backend" },
      );

      expect(await updateStage(deps, "shop", String(backend), { name: " API " })).toEqual({
        status: "ok",
        stage: { id: backend, name: "API", position: 0 },
      });
      expect(store.tasks.map((t) => t.stage)).toEqual(["API", "Frontend", "Backend"]);
      expect(store.locks).toContain("shop");
    });

    it("allows changing only the case of the name", async () => {
      const [backend] = await seed("Backend");
      expect(await updateStage(deps, "shop", String(backend), { name: "backend" })).toMatchObject({
        status: "ok",
        stage: { name: "backend" },
      });
    });

    it("refuses a name another stage has", async () => {
      const [backend] = await seed("Backend", "Frontend");
      expect(await updateStage(deps, "shop", String(backend), { name: "frontend" })).toEqual({
        status: "stage_taken",
      });
      expect(store.names(SHOP)).toEqual(["Backend", "Frontend"]);
    });

    it("moves a stage, shifting the others", async () => {
      const [a, , c] = await seed("A", "B", "C", "D");
      expect(await updateStage(deps, "shop", String(c), { position: 0 })).toEqual({
        status: "ok",
        stage: { id: c, name: "C", position: 0 },
      });
      expect(store.names(SHOP)).toEqual(["C", "A", "B", "D"]);
      await updateStage(deps, "shop", String(a), { position: 3 });
      expect(store.names(SHOP)).toEqual(["C", "B", "D", "A"]);
    });

    it("renames and moves at once", async () => {
      const [a] = await seed("A", "B");
      expect(await updateStage(deps, "shop", String(a), { name: "Z", position: 1 })).toEqual({
        status: "ok",
        stage: { id: a, name: "Z", position: 1 },
      });
      expect(store.names(SHOP)).toEqual(["B", "Z"]);
    });

    it.each([
      [null, "body"],
      [{ name: " " }, "name"],
      [{ position: -1 }, "position"],
      [{ position: 2 }, "position"],
      [{ position: 1.5 }, "position"],
      [{ position: "1" }, "position"],
    ])("rejects %j as an invalid %s", async (body, field) => {
      const [a] = await seed("A", "B");
      expect(await updateStage(deps, "shop", String(a), body)).toEqual({ status: "invalid", field });
      expect(store.names(SHOP)).toEqual(["A", "B"]);
    });

    it("rejects an update without known fields", async () => {
      const [a] = await seed("A");
      expect(await updateStage(deps, "shop", String(a), { other: 1 })).toEqual({ status: "empty_update" });
    });

    it("reports unknown stages, stages of other projects and unknown projects", async () => {
      await seed("A");
      const [other] = (await createStage(deps, "blog", { name: "X" }).then(() => store.stages))
        .filter((s) => s.projectId === 4)
        .map((s) => s.id);
      expect(await updateStage(deps, "shop", "999", { name: "B" })).toEqual({ status: "stage_not_found" });
      expect(await updateStage(deps, "shop", "abc", { name: "B" })).toEqual({ status: "stage_not_found" });
      expect(await updateStage(deps, "shop", String(other), { name: "B" })).toEqual({ status: "stage_not_found" });
      expect(await updateStage(deps, "ghost", "1", { name: "B" })).toEqual({ status: "project_not_found" });
    });
  });

  describe("deleteStage", () => {
    it("deletes an unused stage and closes the gap in positions", async () => {
      const [a, b] = await seed("A", "B", "C");
      store.tasks.push({ projectId: 4, stage: "A" });
      expect(await deleteStage(deps, "shop", String(a))).toEqual({ status: "deleted" });
      expect(await listStages(deps, "shop")).toEqual({
        status: "ok",
        stages: [
          { id: b, name: "B", position: 0 },
          { id: expect.any(Number), name: "C", position: 1 },
        ],
      });
    });

    it("refuses to delete a stage tasks use, with their count", async () => {
      const [a] = await seed("A");
      store.tasks.push({ projectId: SHOP, stage: "A" }, { projectId: SHOP, stage: "a" });
      expect(await deleteStage(deps, "shop", String(a))).toEqual({ status: "stage_in_use", taskCount: 2 });
      expect(store.names(SHOP)).toEqual(["A"]);
    });

    it("reports unknown stages and projects", async () => {
      expect(await deleteStage(deps, "shop", "1")).toEqual({ status: "stage_not_found" });
      expect(await deleteStage(deps, "ghost", "1")).toEqual({ status: "project_not_found" });
    });
  });
});
