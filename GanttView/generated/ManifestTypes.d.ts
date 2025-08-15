/*
*This is auto generated from the ControlManifest.Input.xml file
*/

// Define IInputs and IOutputs Type. They should match with ControlManifest.
export interface IInputs {
    ganttStartDate: ComponentFramework.PropertyTypes.DateTimeProperty;
    ganttEndDate: ComponentFramework.PropertyTypes.DateTimeProperty;
    currentDate: ComponentFramework.PropertyTypes.DateTimeProperty;
    expandDetails: ComponentFramework.PropertyTypes.TwoOptionsProperty;
    colors: ComponentFramework.PropertyTypes.StringProperty;
    columnViewCount: ComponentFramework.PropertyTypes.WholeNumberProperty;
    adjustableEndDate: ComponentFramework.PropertyTypes.TwoOptionsProperty;
    fontColor: ComponentFramework.PropertyTypes.StringProperty;
    fontSize: ComponentFramework.PropertyTypes.WholeNumberProperty;
    showFilters: ComponentFramework.PropertyTypes.TwoOptionsProperty;
    filtersText: ComponentFramework.PropertyTypes.StringProperty;
    records: ComponentFramework.PropertyTypes.DataSet;
}
export interface IOutputs {
    selectedId?: string;
    selectedRowType?: string;
}
