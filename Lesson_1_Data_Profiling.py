# =============================================================================
# LESSON 1: DATA INSPECTION & PROFILING (SCMS DATASET)
# =============================================================================
# Before writing any complex data analysis code, a Business or Data Analyst 
# must first "get to know" their data. 
#
# In this lesson, you will learn how to:
#   1. Load a large Excel dataset using Pandas.
#   2. Inspect its dimensions (rows and columns).
#   3. View columns, data types, and count missing values.
#   4. Spot initial "data quality" issues that need cleaning.
# =============================================================================

import pandas as pd

# 1. Loading the Excel file
# Since this is a large dataset (~10,000 rows), loading it may take 2-3 seconds.
print("Loading SCMS_Delivery_History_Dataset.csv.xlsx... Please wait.")
file_path = "SCMS_Delivery_History_Dataset.csv.xlsx"
df = pd.read_excel(file_path)
print("Dataset successfully loaded!")

# 2. Inspecting the Shape of the Data
# .shape returns a tuple: (number of rows, number of columns)
rows, cols = df.shape
print(f"\n--- 1. DATASET DIMENSIONS ---")
print(f"Total Rows: {rows}")
print(f"Total Columns: {cols}")

# 3. Viewing the first 5 records
# .head(n) returns the first n rows of the dataframe. 
# (By default it's 5. Let's look at 3 to keep it readable in the terminal).
print(f"\n--- 2. FIRST 3 RECORDS ---")
pd.set_option('display.max_columns', 10)  # Restrict columns shown for neatness
print(df.head(3))

# 4. Profiling Columns, Data Types, and Missing Values
# In Python, we can check each column's data type and count how many empty values it has.
print(f"\n--- 3. COLUMN PROFILE SUMMARY ---")
profile = pd.DataFrame({
    'Data Type': df.dtypes.astype(str),
    'Non-Null Count': df.notnull().sum(),
    'Null Count': df.isnull().sum(),
    'Unique Values': df.nunique()
})
print(profile.head(15))  # Showing first 15 columns for preview
print("\n... and more columns. Run profile.to_string() in your code to see all 33 columns!")

# 5. Identifying Data Quality Red Flags
# Look closely at the data types! 
# - 'Weight (Kilograms)' is listed as an 'object' (text) instead of a float/numeric!
# - 'Freight Cost (USD)' is also an 'object'!
# This means there is text data mixed into these number columns. We will clean this in Lesson 2!

# =============================================================================
# 🎯 YOUR TURN! (HANDS-ON EXERCISE)
# Let's write some code to answer these critical business questions:
#   1. Which 5 countries receive the most shipments in this dataset?
#   2. How many different brands are represented in this dataset?
#   3. What are the unique shipment modes (Air, Ocean, etc.) and their counts?
#
# INSTRUCTIONS:
# - Scroll down and complete the code blocks under the comments.
# - Once done, save the file and run it in the terminal!
# =============================================================================

print("\n" + "="*50)
print("YOUR TURN: BUSINESS ANALYSIS CHALLENGE")
print("="*50)

# Challenge 1: Top 5 countries by shipment count
# Hint: Use df['Country'].value_counts().head(5)
print("\n[Challenge 1] Top 5 countries with the highest shipments:")
# TODO: Write your code here
# top_countries = ...
# print(top_countries)

# Challenge 2: Total number of unique brands
# Hint: Use df['Brand'].nunique()
print("\n[Challenge 2] Total number of unique brands:")
# TODO: Write your code here
# brand_count = ...
# print(brand_count)

# Challenge 3: Distribution of Shipment Modes
# Hint: Use df['Shipment Mode'].value_counts(dropna=False)
print("\n[Challenge 3] Shipment Mode distribution:")
# TODO: Write your code here
# shipment_modes = ...
# print(shipment_modes)
