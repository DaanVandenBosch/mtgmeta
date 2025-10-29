import { assert, type Logger } from "./core";

export const DEPENDENCY_SYMBOL = Symbol("dependency");
export const LEAF_DEPENDENT_SYMBOL = Symbol("leaf");

export interface Dependency {
    [DEPENDENCY_SYMBOL]: true;
}

export interface Dependent {
    invalidated(dependency: Dependency): void;
}

export interface Leaf_Dependent extends Dependent {
    [LEAF_DEPENDENT_SYMBOL]: true;
    update(): void;
}

function is_dependency(object: any): object is Dependency {
    return (object as Dependency)[DEPENDENCY_SYMBOL];
}

function is_leaf(dependent: Dependent): dependent is Leaf_Dependent {
    return (dependent as Leaf_Dependent)[LEAF_DEPENDENT_SYMBOL];
}

export class Deps {
    private logger: Logger;
    private dependent_to_dependencies = new Map<Dependent, Set<Dependency>>;
    private dependency_to_dependents = new Map<Dependency, Set<Dependent>>;
    private out_of_date_dependents = new Set<Leaf_Dependent>;
    private update_scheduled = false;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    add(dependent: Dependent, ...dependencies: Dependency[]) {
        let dependencies_set = this.dependent_to_dependencies.get(dependent);

        if (dependencies_set === undefined) {
            dependencies_set = new Set;
            this.dependent_to_dependencies.set(dependent, dependencies_set);
        }

        for (const dependency of dependencies) {
            dependencies_set.add(dependency);

            let dependents = this.dependency_to_dependents.get(dependency);

            if (dependents === undefined) {
                dependents = new Set;
                this.dependency_to_dependents.set(dependency, dependents);
            }

            dependents.add(dependent);
        }
    }

    remove(dependent: Dependent, ...dependencies: Dependency[]) {
        let dependencies_set = this.dependent_to_dependencies.get(dependent);

        if (dependencies_set === undefined) {
            return;
        }

        for (const dependency of dependencies) {
            const was_dependency = dependencies_set.delete(dependency);

            if (was_dependency) {
                let deleted = this.dependency_to_dependents.get(dependency)!.delete(dependent);
                assert(deleted);
            }
        }
    }

    remove_all(dependent: Dependent) {
        const dependencies = this.dependent_to_dependencies.get(dependent);

        if (dependencies !== undefined) {
            for (const dependency of dependencies) {
                const deleted = this.dependency_to_dependents.get(dependency)!.delete(dependent);
                assert(deleted);
            }

            this.dependent_to_dependencies.delete(dependent);
        }
    }

    changed(dependency: Dependency) {
        this.invalidate(dependency);

        if (!this.update_scheduled) {
            requestAnimationFrame(() => {
                this.update_scheduled = false;

                try {
                    for (const dependent of this.out_of_date_dependents) {
                        try {
                            dependent.update();
                        } catch (e) {
                            this.logger.error(e);
                        }
                    }
                } finally {
                    this.out_of_date_dependents.clear();
                }
            });
            this.update_scheduled = true;
        }
    }

    private invalidate(dependency: Dependency) {
        const dependents = this.dependency_to_dependents.get(dependency);

        if (dependents) {
            for (const dependent of dependents) {
                if (is_leaf(dependent)) {
                    this.out_of_date_dependents.add(dependent);
                }

                dependent.invalidated(dependency);

                if (is_dependency(dependent)) {
                    this.invalidate(dependent);
                }
            }
        }
    }
}
