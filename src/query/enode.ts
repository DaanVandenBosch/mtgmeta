import type { Comparison_Condition, Mana_Cost, Substring_Condition } from "../query";

export enum Comparison_Operator {
    EQ = 1,
    NE = 2,
    LT = 3,
    GT = 4,
    LE = 5,
    GE = 6,
}

export enum Enode_Type {
    Disjunction = 1,
    Conjunction = 2,
    Comparison = 3,
    Mana_Cost = 4,
    Mana_Cost_Number = 5,
    Substring = 6,
    Substring_Per_face = 7,
}

/** Execution node. */
export type Enode =
    Enode_Disjunction |
    Enode_Conjunction |
    Enode_Comparison |
    Enode_Mana_Cost |
    Enode_Mana_Cost_Number |
    Enode_Substring |
    Enode_Substring_Per_face;

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
    readonly condition: Comparison_Condition,
    readonly card_values: ReadonlyArray<unknown>,
    readonly values_are_arrays: boolean,
    readonly operator: Comparison_Operator,
}

export type Enode_Mana_Cost = {
    readonly type: Enode_Type.Mana_Cost,
    readonly condition: Comparison_Condition & { value: Mana_Cost },
    readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>,
    readonly per_face: boolean,
    readonly operator: Comparison_Operator,
}

export type Enode_Mana_Cost_Number = {
    readonly type: Enode_Type.Mana_Cost_Number,
    readonly condition: Comparison_Condition & { value: number },
    readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>,
    readonly per_face: boolean,
    readonly operator: Comparison_Operator,
}

export type Enode_Substring = {
    readonly type: Enode_Type.Substring,
    readonly condition: Substring_Condition,
    readonly card_values: ReadonlyArray<string>,
}

export type Enode_Substring_Per_face = {
    readonly type: Enode_Type.Substring_Per_face,
    readonly condition: Substring_Condition,
    readonly card_values: ReadonlyArray<ReadonlyArray<string>>,
}
