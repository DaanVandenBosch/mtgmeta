import type { Query_Result_Model, Query_Result_State } from "./query_result_model";

export class Search_Model {
    readonly result: Query_Result_Model;

    constructor(result: Query_Result_Model) {
        this.result = result;
    }

    async set(state: Query_Result_State, execute_query?: boolean) {
        await this.result.set(state, execute_query);
    }

    async preload_data(query_string: string) {
        await this.result.preload_data(query_string);
    }
};
