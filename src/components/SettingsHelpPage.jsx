// src/components/SettingsHelpPage.jsx

import React from "react";

const SettingsHelpPage = () => {
  return (
    <div className="p-4 text-gray-100 w-full">
      <h2 className="text-3xl font-bold mb-6 text-blue-300">Settings & Help</h2>

      <div className="mb-8">
        <h3 className="text-xl font-semibold mb-3">Settings</h3>

        <p className="mb-2">Manage your preferences here:</p>

        <ul className="list-disc list-inside ml-4 text-gray-300">
          <li>Notification preferences</li>

          <li>Privacy settings</li>

          <li>Account linked services</li>
        </ul>

        <button className="mt-4 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition duration-200">
          Save Settings
        </button>
      </div>

      <div>
        <h3 className="text-xl font-semibold mb-3">Help</h3>

        <p className="mb-2">Find answers to common questions:</p>

        <ul className="list-disc list-inside ml-4 text-gray-300">
          <li>How to start a new query?</li>

          <li>Managing recent cases</li>

          <li>Troubleshooting tips</li>

          <li>Contact support</li>
        </ul>

        <p className="mt-4">
          For urgent assistance, please contact our support team at{" "}
          <a
            href="mailto:support@virlaw.com"
            className="text-blue-400 hover:underline"
          >
            support@virlaw.com
          </a>
          .
        </p>
      </div>
    </div>
  );
};

export default SettingsHelpPage;
