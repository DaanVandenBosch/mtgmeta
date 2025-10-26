import { assert, Console_Logger } from "./core";

export interface Dependent {
    update(): void;
}

export class Deps {
    private dependent_to_dependencies = new Map<Dependent, Set<any>>;
    private dependency_to_dependents = new Map<any, Set<Dependent>>;
    private out_of_date_dependents = new Set<Dependent>;
    private update_scheduled = false;

    add(dependent: Dependent, ...dependencies: any[]) {
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

    remove_all(dependent: Dependent) {
        const dependencies = this.dependent_to_dependencies.get(dependent);

        if (dependencies !== undefined) {
            for (const dependency of dependencies) {
                const changed = this.dependency_to_dependents.get(dependency)!.delete(dependent);
                assert(changed);
            }

            this.dependent_to_dependencies.delete(dependent);
        }
    }

    changed(...dependencies: any[]) {
        for (const dependency of dependencies) {
            const dependents = this.dependency_to_dependents.get(dependency);

            if (dependents) {
                for (const dependent of dependents) {
                    this.out_of_date_dependents.add(dependent);
                }
            }
        }

        if (!this.update_scheduled) {
            requestAnimationFrame(() => {
                this.update_scheduled = false;

                try {
                    for (const dependent of this.out_of_date_dependents) {
                        try {
                            dependent.update();
                        } catch (e) {
                            Console_Logger.error(e);
                        }
                    }
                } finally {
                    this.out_of_date_dependents.clear();
                }
            });
            this.update_scheduled = true;
        }
    }
}
