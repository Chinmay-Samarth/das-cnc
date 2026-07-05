import MasterItemSelect from './MasterItemSelect';

export { mapMasterRecord as mapRawMaterialRecord, fetchMasterRecordDetails as fetchRawMaterialDetails } from './MasterItemSelect';

export default function RawMaterialSelect(props) {
  return (
    <MasterItemSelect
      masterSlug="raw-material"
      category="raw_material"
      placeholder="Search raw material by RM ID..."
      {...props}
    />
  );
}
