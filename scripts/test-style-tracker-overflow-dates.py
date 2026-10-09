import importlib.util
from pathlib import Path
from datetime import datetime
import unittest
sp=importlib.util.spec_from_file_location('converter',Path(__file__).with_name('import-style-tracker-xlsx.py'));m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
class DateFidelityTests(unittest.TestCase):
 def test_google_display_beyond_year_9999(self):
  self.assertEqual(m.extended_excel_date('6685006',datetime(1899,12,30)),'12/3/20202')
 def test_gregorian_leap_day_and_century(self):
  from openpyxl.utils.datetime import to_excel
  for d in (datetime(2000,2,29),datetime(2100,3,1),datetime(2026,10,8)):
   self.assertEqual(m.extended_excel_date(str(to_excel(d)),datetime(1899,12,30)),f'{d.month}/{d.day}/{d.year}')
 def test_1904_epoch(self):
  self.assertEqual(m.extended_excel_date('0',datetime(1904,1,1)),'1/1/1904')
 def test_bad_fractional_or_nonfinite_date_refused(self):
  for value in ('6685006.5','NaN','Infinity'):
   with self.assertRaises(ValueError):m.extended_excel_date(value,datetime(1899,12,30))
 def test_large_number_without_date_format_is_preserved(self):
  from types import SimpleNamespace
  c=SimpleNamespace(coordinate='A1',number_format='0',value=6685006)
  self.assertEqual(m.cell_display(c,{'A1':'6685006'},datetime(1899,12,30)),'6685006')
 def test_date_format_recovers_converter_error(self):
  from types import SimpleNamespace
  c=SimpleNamespace(coordinate='A1',number_format='m/d/yyyy',value='#VALUE!')
  self.assertEqual(m.cell_display(c,{'A1':'6685006'},datetime(1899,12,30)),'12/3/20202')
 def test_real_xml_relationship_paths_and_numeric_types(self):
  from zipfile import ZipFile
  from tempfile import TemporaryDirectory
  for target in ('worksheets/sheet1.xml','/xl/worksheets/sheet1.xml'):
   with TemporaryDirectory() as scratch:
    path=Path(scratch)/'source.xlsx'
    with ZipFile(path,'w') as z:
     z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="License.Style" r:id="rId1" /></sheets></workbook>')
     z.writestr('xl/_rels/workbook.xml.rels',f'<Relationships><Relationship Id="rId1" Target="{target}" /></Relationships>')
     z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="n"><v>6685006</v></c><c r="B1" t="e"><v>#VALUE!</v></c><c r="C1" t="n"><v>2958465.5</v></c></row></sheetData></worksheet>')
    self.assertEqual(m.raw_overflow_values(path,'License.Style',datetime(1899,12,30)),{'A1':'6685006'})
 def test_valid_last_day_fractional_datetime_keeps_existing_display(self):
  from types import SimpleNamespace
  c=SimpleNamespace(coordinate='A1',number_format='m/d/yyyy',value=datetime(9999,12,31,12))
  self.assertEqual(m.cell_display(c,{},datetime(1899,12,30)),'9999-12-31 12:00:00')
unittest.main()
