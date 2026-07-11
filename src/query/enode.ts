import type { Mana_Cost } from "../query";

export enum Comparison_Operator {
    EQ = 1,
    LT = 2,
    LE = 3,
}

export enum Enode_Type {
    Disjunction = 1,
    Conjunction = 2,
    Comparison = 3,
    Mana_Cost = 4,
    Mana_Cost_Number = 5,
    Substring = 6,
    Substring_Per_face = 7,
    Even = 8,
}

/** Execution node. */
export type Enode =
    Enode_Disjunction |
    Enode_Conjunction |
    Enode_Comparison |
    Enode_Mana_Cost |
    Enode_Mana_Cost_Number |
    Enode_Substring |
    Enode_Substring_Per_face |
    Enode_Even;

export type Enode_Disjunction = {
    readonly type: Enode_Type.Disjunction,
    readonly children: ReadonlyArray<Enode>,
}

export type Enode_Conjunction = {
    readonly type: Enode_Type.Conjunction,
    readonly children: ReadonlyArray<Enode>,
}

export type Enode_Comparison = {
    readonly type: Enode_Type.Comparison,
    readonly card_values: ReadonlyArray<unknown>,
    readonly values_are_arrays: boolean,
    readonly condition_value: number | boolean | string | Mana_Cost
    readonly operator: Comparison_Operator,
    readonly negated: boolean,
}

export type Enode_Mana_Cost = {
    readonly type: Enode_Type.Mana_Cost,
    readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>,
    readonly per_face: boolean,
    readonly condition_value: Mana_Cost,
    readonly operator: Comparison_Operator,
    readonly negated: boolean,
}

export type Enode_Mana_Cost_Number = {
    readonly type: Enode_Type.Mana_Cost_Number,
    readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>,
    readonly per_face: boolean,
    readonly condition_value: number,
    readonly operator: Comparison_Operator,
    readonly negated: boolean,
}

export type Enode_Substring = {
    readonly type: Enode_Type.Substring,
    readonly card_values: ReadonlyArray<string>,
    readonly condition_value: string,
    readonly negated: boolean,
}

export type Enode_Substring_Per_face = {
    readonly type: Enode_Type.Substring_Per_face,
    readonly card_values: ReadonlyArray<ReadonlyArray<string>>,
    readonly condition_value: string,
    readonly negated: boolean,
}

export type Enode_Even = {
    readonly type: Enode_Type.Even,
    readonly card_values: ReadonlyArray<number>,
    readonly negated: boolean,
}
